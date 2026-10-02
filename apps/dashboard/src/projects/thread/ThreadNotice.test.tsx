import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import type { Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import { json, mockHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { formatCountdown, ThreadNotice } = await import("./ThreadNotice");

const NOW = Date.parse("2026-09-30T10:00:00.000Z");
let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
  jest.useRealTimers();
  setSystemTime();
});

const rateLimited = (resumesInMs: number): Thread =>
  ({
    ...makeThread({ id: "thr_1", status: "rate-limited" }),
    resumesAt: new Date(NOW + resumesInMs).toISOString(),
  }) as Thread;

const countdown = () => screen.getByTestId("thread-resume-countdown");

describe("threads that are not simply working", () => {
  test("a queued thread says it waits for a slot and starts by itself", () => {
    render(<ThreadNotice thread={makeThread({ status: "queued" })} />);

    const notice = screen.getByTestId("thread-notice-queued");
    expect(notice.textContent).toContain("Queued.");
    expect(notice.textContent).toContain("starts by itself when a slot is free");
  });

  test("a landing thread says the merge is running and it takes no message", () => {
    render(<ThreadNotice thread={makeThread({ status: "landing" })} />);

    expect(screen.getByTestId("thread-notice-landing").textContent).toContain(
      "Merging the pull request.",
    );
  });

  test("a resolved thread says a message reopens it", () => {
    render(<ThreadNotice thread={makeThread({ status: "resolved" })} />);

    const text = screen.getByTestId("thread-notice-resolved").textContent ?? "";
    expect(text).toContain("Resolved");
    expect(text).toContain("A message reopens it and brings its branch back.");
    expect(text).not.toContain("merged");
  });

  test("a thread resolved by a merged pull request says its branch is gone", () => {
    const merged = makeThread({
      status: "resolved",
      artifacts: [
        { type: "pr", number: 7, url: "https://github.com/acme/app/pull/7", state: "merged" },
      ],
    });
    render(<ThreadNotice thread={merged} />);

    const text = screen.getByTestId("thread-notice-resolved").textContent ?? "";
    expect(text).toContain("Its pull request merged, so its branch is gone");
    expect(text).not.toContain("reopens");
  });

  test("a resolved thread whose pull request was only closed still offers to reopen", () => {
    const closed = makeThread({
      status: "resolved",
      artifacts: [
        { type: "pr", number: 7, url: "https://github.com/acme/app/pull/7", state: "closed" },
      ],
    });
    render(<ThreadNotice thread={closed} />);

    expect(screen.getByTestId("thread-notice-resolved").textContent).toContain("reopens it");
  });

  test.each(["working", "idle", "waiting-on-you", "ready-for-review"] as const)(
    "a %s thread has no notice",
    (status) => {
      const { container } = render(<ThreadNotice thread={makeThread({ status })} />);

      expect(container.textContent).toBe("");
    },
  );
});

describe("a rate-limited thread", () => {
  test("counts down to the reset, second by second", () => {
    jest.useFakeTimers({ now: NOW });
    render(<ThreadNotice thread={rateLimited(12 * 60_000 + 4_000)} />);

    expect(countdown().textContent).toBe("in 12m 04s");
    expect(countdown().getAttribute("data-remaining-ms")).toBe(String(12 * 60_000 + 4_000));

    act(() => {
      jest.advanceTimersByTime(4_000);
    });
    expect(countdown().textContent).toBe("in 12m 00s");

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(countdown().textContent).toBe("in 11m 00s");
  });

  test("says it is resuming once the reset has passed", () => {
    jest.useFakeTimers({ now: NOW });
    render(<ThreadNotice thread={rateLimited(3_000)} />);
    expect(countdown().textContent).toBe("in 3s");

    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(countdown().textContent).toBe("resuming now");
    expect(countdown().getAttribute("data-remaining-ms")).toBe("0");
  });

  test("a reset already in the past is resuming now", () => {
    setSystemTime(NOW);
    render(<ThreadNotice thread={rateLimited(-60_000)} />);

    expect(countdown().textContent).toBe("resuming now");
  });

  test("says when it resumes by itself", () => {
    setSystemTime(NOW);
    render(<ThreadNotice thread={rateLimited(90_000)} />);

    const notice = screen.getByTestId("thread-notice-rate-limited");
    expect(notice.textContent).toContain("Rate limited.");
    expect(notice.textContent).toContain("It resumes by itself at");
  });

  test("Resume now ends the wait through the host, without waiting for the reset", async () => {
    setSystemTime(NOW);
    host.respondWith(() => json({ thread: rateLimited(0) }));
    render(<ThreadNotice thread={rateLimited(3_600_000)} />);

    fireEvent.click(screen.getByTestId("thread-resume"));

    await act(async () => {});
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/resume", body: undefined },
    ]);
  });
});

describe("a rate-limited thread whose project has auto-continue off", () => {
  test("says when the limit resets and that the thread waits for the person", () => {
    setSystemTime(NOW);
    render(<ThreadNotice thread={rateLimited(90_000)} autoContinue={false} />);

    const text = screen.getByTestId("thread-notice-rate-limited").textContent ?? "";
    expect(text).toContain("The limit resets at");
    expect(text).toContain("Auto-continue is off for this project, so the thread waits for you.");
    expect(text).not.toContain("resumes by itself");
    expect(countdown().textContent).toBe("in 1m 30s");
    expect(screen.getByTestId("thread-resume").textContent).toBe("Resume now");
  });

  test("past the reset it stays stopped and offers Resume, which ends the wait", async () => {
    setSystemTime(NOW);
    host.respondWith(() => json({ thread: rateLimited(0) }));
    render(<ThreadNotice thread={rateLimited(-60_000)} autoContinue={false} />);

    expect(countdown().textContent).toBe("it has reset");
    const resume = screen.getByTestId("thread-resume");
    expect(resume.textContent).toBe("Resume");

    fireEvent.click(resume);
    await act(async () => {});
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/resume", body: undefined },
    ]);
  });
});

describe("formatCountdown", () => {
  test.each([
    [0, "0s"],
    [-5_000, "0s"],
    [1, "1s"],
    [999, "1s"],
    [42_000, "42s"],
    [59_001, "1m 00s"],
    [60_000, "1m 00s"],
    [724_000, "12m 04s"],
    [3_599_000, "59m 59s"],
    [3_600_000, "1h 00m"],
    [3_900_000, "1h 05m"],
    [7_384_000, "2h 03m"],
  ])("%d ms reads %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("a working thread that needs the person", () => {
  test("waiting on them outside AOP, it says what for and opens where they act", () => {
    render(
      <ThreadNotice
        thread={makeThread({
          status: "working",
          waitingOn: {
            reason: "Approve the production deployment",
            link: "https://github.com/acme/app/actions/runs/1",
            since: "2026-09-30T10:00:00.000Z",
          },
        })}
      />,
    );

    const notice = screen.getByTestId("thread-notice-waiting-on");
    expect(notice.textContent).toContain(
      "Waiting on you. Approve the production deployment. The thread keeps working meanwhile.",
    );
    expect(screen.getByTestId("thread-wait-open").getAttribute("href")).toBe(
      "https://github.com/acme/app/actions/runs/1",
    );
  });

  test("whose AOP tools are lost, it says what that means and how to recover", () => {
    render(
      <ThreadNotice
        thread={makeThread({
          status: "working",
          degraded: { reason: "Its call failed.", since: "2026-09-30T10:00:00.000Z" },
        })}
      />,
    );

    const notice = screen.getByTestId("thread-notice-degraded");
    expect(notice.textContent).toContain("AOP tools lost. Its call failed.");
    expect(notice.textContent).toContain("Stop it and send it a message");
  });

  test("a thread simply working shows nothing", () => {
    render(<ThreadNotice thread={makeThread({ status: "working" })} />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});
