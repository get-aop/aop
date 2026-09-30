import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ThreadUsage } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import { hostError, json, mockHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ThreadUsageChip } = await import("./ThreadUsageChip");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
});

const usage = (totals: Partial<ThreadUsage["totals"]> = {}): ThreadUsage => ({
  threadId: "thr_1",
  window: { since: null, until: null },
  totals: {
    inputTokens: 1_000,
    outputTokens: 200,
    cacheWriteTokens: 3_000,
    cacheReadTokens: 50_000,
    costUsd: 0.16125,
    runs: 2,
    ...totals,
  },
  byModel: [
    {
      provider: "claude-code",
      model: "claude-opus-5",
      inputTokens: 1_000,
      outputTokens: 200,
      cacheWriteTokens: 3_000,
      cacheReadTokens: 50_000,
      costUsd: 0.16125,
      runs: 2,
    },
  ],
});

const usageRequests = () => host.to("/api/usage/threads/thr_1", "GET");

describe("the chip", () => {
  test("says nothing before the thread has had a run", async () => {
    host.respondWith(() => json(usage({ runs: 0, inputTokens: 0, cacheReadTokens: 0 })));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    await waitFor(() => expect(usageRequests()).toHaveLength(1));
    await act(async () => {});

    expect(screen.queryByTestId("thread-usage")).toBeNull();
  });

  test("says nothing when the host cannot answer, and does not raise an error", async () => {
    host.respondWith(() => hostError(500, "UNKNOWN", "boom"));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    await waitFor(() => expect(usageRequests()).toHaveLength(1));
    await act(async () => {});

    expect(screen.queryByTestId("thread-usage")).toBeNull();
  });

  test("shows all the tokens the runs used and what they cost", async () => {
    host.respondWith(() => json(usage()));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    const chip = await screen.findByTestId("thread-usage");

    expect(chip.getAttribute("data-tokens")).toBe("54200");
    expect(chip.textContent).toBe("54,200 tokens · $0.16");
  });

  test("leaves the cost out when the runtime reported none", async () => {
    host.respondWith(() => json(usage({ costUsd: null })));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    const chip = await screen.findByTestId("thread-usage");

    expect(chip.textContent).toBe("54,200 tokens");
  });

  test("a cost under a cent still reads as a cost", async () => {
    host.respondWith(() => json(usage({ costUsd: 0.004 })));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    expect((await screen.findByTestId("thread-usage")).textContent).toContain("<$0.01");
  });
});

describe("the popover", () => {
  test("shows each bucket, how much came from the cache, the runs and the models", async () => {
    host.respondWith(() => json(usage()));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    fireEvent.click(await screen.findByTestId("thread-usage"));

    const details = await screen.findByTestId("thread-usage-details");
    expect(screen.getByTestId("usage-input").getAttribute("data-value")).toBe("1000");
    expect(screen.getByTestId("usage-output").getAttribute("data-value")).toBe("200");
    expect(screen.getByTestId("usage-cache-write").getAttribute("data-value")).toBe("3000");
    expect(screen.getByTestId("usage-cache-read").getAttribute("data-value")).toBe("50000");
    expect(screen.getByTestId("usage-cache-read").textContent).toBe("50,000");
    // 50,000 cache reads of 54,000 tokens the model was given (input, cache write, cache read).
    expect(details.textContent).toContain("93% of what the model read came from the cache");
    expect(details.textContent).toContain("2 runs");
    expect(details.textContent).toContain("Opus 5");
  });

  test("says '1 run' in the singular", async () => {
    host.respondWith(() => json(usage({ runs: 1 })));
    render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);

    fireEvent.click(await screen.findByTestId("thread-usage"));

    expect((await screen.findByTestId("thread-usage-details")).textContent).toContain("1 run");
    expect(screen.getByTestId("thread-usage-details").textContent).not.toContain("1 runs");
  });
});

describe("staying current", () => {
  test("reads again when the thread changes status, since a run records its usage as it ends", async () => {
    let served = usage({
      inputTokens: 100,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    host.respondWith(() => json(served));
    const { rerender } = render(
      <ThreadUsageChip thread={makeThread({ id: "thr_1", status: "working" })} />,
    );
    expect((await screen.findByTestId("thread-usage")).textContent).toContain("100 tokens");

    served = usage({ inputTokens: 900, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });
    rerender(<ThreadUsageChip thread={makeThread({ id: "thr_1", status: "idle" })} />);

    await waitFor(() =>
      expect(screen.getByTestId("thread-usage").textContent).toContain("900 tokens"),
    );
    expect(usageRequests()).toHaveLength(2);
  });

  test("does not read again when nothing about the status changed", async () => {
    host.respondWith(() => json(usage()));
    const { rerender } = render(
      <ThreadUsageChip thread={makeThread({ id: "thr_1", status: "idle", unread: false })} />,
    );
    await screen.findByTestId("thread-usage");

    rerender(
      <ThreadUsageChip thread={makeThread({ id: "thr_1", status: "idle", unread: true })} />,
    );
    await act(async () => {});

    expect(usageRequests()).toHaveLength(1);
  });

  test("keeps what it showed if a later read fails", async () => {
    host.respondWith(() => json(usage()));
    const { rerender } = render(
      <ThreadUsageChip thread={makeThread({ id: "thr_1", status: "working" })} />,
    );
    await screen.findByTestId("thread-usage");

    host.respondWith(() => hostError(500, "UNKNOWN", "boom"));
    rerender(<ThreadUsageChip thread={makeThread({ id: "thr_1", status: "idle" })} />);
    await waitFor(() => expect(usageRequests()).toHaveLength(2));
    await act(async () => {});

    expect(screen.getByTestId("thread-usage").textContent).toContain("54,200 tokens");
  });

  test("a thread that is opened next shows its own usage, not the last one's", async () => {
    host.respondWith((request) =>
      json(
        request.url.endsWith("/thr_2")
          ? {
              ...usage({
                inputTokens: 5,
                outputTokens: 0,
                cacheWriteTokens: 0,
                cacheReadTokens: 0,
              }),
              threadId: "thr_2",
            }
          : usage(),
      ),
    );
    const { rerender } = render(<ThreadUsageChip thread={makeThread({ id: "thr_1" })} />);
    await screen.findByTestId("thread-usage");

    rerender(<ThreadUsageChip thread={makeThread({ id: "thr_2" })} />);

    await waitFor(() =>
      expect(screen.getByTestId("thread-usage").textContent).toContain("5 tokens"),
    );
    expect(host.to("/api/usage/threads/thr_2", "GET")).toHaveLength(1);
  });
});
