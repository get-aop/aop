import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { AT, makeThread } from "./test-utils";
import { json, mockHost } from "./thread/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ThreadCard } = await import("./ThreadCard");

const NOW = Date.parse(AT) + 5 * 60_000;

afterEach(cleanup);
beforeEach(() => window.history.pushState({}, "", "/"));

const card = () => screen.getByTestId("thread-card");

describe("ThreadCard", () => {
  test("a working thread shows its status, steps ring, live line and age", () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({
          status: "working",
          steps: [
            { label: "Reproduce", state: "done" },
            { label: "Bisect", state: "active" },
            { label: "Fix", state: "pending" },
          ],
          liveStatusLine: "Bisecting · 7 commits left",
        })}
      />,
    );

    expect(card().getAttribute("data-status")).toBe("working");
    expect(screen.getByTestId("thread-status-label").textContent).toBe("Working");
    const ring = screen.getByTestId("thread-steps");
    expect(ring.getAttribute("data-done")).toBe("1");
    expect(ring.getAttribute("data-total")).toBe("3");
    expect(ring.textContent).toBe("1/3");
    expect(screen.getByTestId("thread-status-line").textContent).toBe("Bisecting · 7 commits left");
    expect(within(card()).getByText("5m")).toBeTruthy();
  });

  test("a thread with no checklist yet has no ring", () => {
    render(<ThreadCard now={NOW} thread={makeThread({ steps: [] })} />);
    expect(screen.queryByTestId("thread-steps")).toBeNull();
    expect(screen.queryByTestId("thread-status-line")).toBeNull();
  });

  test("a blocked thread leads with the question, in the attention colour, and has no ring", () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({
          status: "waiting-on-you",
          steps: [{ label: "Pick", state: "active" }],
        })}
      />,
    );

    expect(screen.getByTestId("thread-status-label").textContent).toBe("Waiting on you");
    expect(screen.getByTestId("thread-status-line").textContent).toBe("Blocked · Which database?");
    expect(screen.queryByTestId("thread-steps")).toBeNull();
    expect(card().className).toContain("border-waiting");
  });

  test("an unread thread marks its title", () => {
    render(<ThreadCard now={NOW} thread={makeThread({ unread: true })} />);
    expect(card().getAttribute("data-unread")).toBe("true");
    expect(screen.getByTestId("thread-unread-dot")).toBeTruthy();

    cleanup();
    render(<ThreadCard now={NOW} thread={makeThread({ unread: false })} />);
    expect(screen.queryByTestId("thread-unread-dot")).toBeNull();
  });

  test("its pull request is a chip that opens the pull request, and documents are counted", () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({
          status: "ready-for-review",
          branch: "aop/cold-start",
          artifacts: [
            {
              type: "pr",
              number: 4821,
              url: "https://github.com/acme/app/pull/4821",
              state: "merged",
            },
            { type: "doc", name: "Findings" },
            { type: "doc", name: "Notes" },
          ],
        })}
      />,
    );

    const chip = screen.getByTestId("thread-pr-chip") as HTMLAnchorElement;
    expect(chip.textContent).toBe("#4821");
    expect(chip.href).toBe("https://github.com/acme/app/pull/4821");
    expect(chip.getAttribute("data-state")).toBe("merged");
    expect(chip.target).toBe("_blank");
    expect(chip.rel).toContain("noopener");
    expect(screen.getByTestId("thread-docs").textContent).toBe("2 documents");
    expect(within(card()).getByText("aop/cold-start")).toBeTruthy();
  });

  test("the chip of an open pull request shows what its checks add up to, and a merged one does not", () => {
    const pr = { type: "pr" as const, number: 7, url: "https://github.com/acme/app/pull/7" };
    const renderWith = (overrides: Parameters<typeof makeThread>[0]) =>
      render(<ThreadCard now={NOW} thread={makeThread(overrides)} />);
    renderWith({
      artifacts: [
        {
          ...pr,
          state: "open",
          checks: { state: "failure", successful: 2, failing: 2, pending: 0 },
        },
      ],
    });
    const chip = screen.getByTestId("thread-pr-chip");
    expect(chip.getAttribute("data-checks")).toBe("failure");
    expect(chip.getAttribute("title")).toBe("2 checks failing");
    expect(screen.getByTestId("thread-pr-chip-checks").getAttribute("aria-label")).toBe(
      "2 checks failing",
    );

    cleanup();
    renderWith({
      artifacts: [
        {
          ...pr,
          state: "open",
          checks: { state: "pending", successful: 0, failing: 0, pending: 1 },
        },
      ],
    });
    expect(screen.getByTestId("thread-pr-chip").getAttribute("title")).toBe("1 check running");

    cleanup();
    renderWith({
      artifacts: [
        {
          ...pr,
          state: "open",
          checks: { state: "success", successful: 3, failing: 0, pending: 0 },
        },
      ],
    });
    expect(screen.getByTestId("thread-pr-chip").getAttribute("title")).toBe("All checks passed");

    // Once merged, the last reading is history and the chip is only its state.
    cleanup();
    renderWith({
      artifacts: [
        {
          ...pr,
          state: "merged",
          checks: { state: "pending", successful: 0, failing: 0, pending: 1 },
        },
      ],
    });
    expect(screen.getByTestId("thread-pr-chip").getAttribute("data-checks")).toBeNull();
    expect(screen.queryByTestId("thread-pr-chip-checks")).toBeNull();

    cleanup();
    renderWith({ artifacts: [{ ...pr, state: "open" }] });
    expect(screen.queryByTestId("thread-pr-chip-checks")).toBeNull();
  });

  test("the card opens the thread inside the app", () => {
    render(<ThreadCard now={NOW} thread={makeThread({ id: "t 1", projectId: "p1" })} />);

    const link = screen.getByTestId("thread-card-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/p1/threads/t%201");
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/projects/p1/threads/t%201");
  });

  test("a queued or rate-limited thread has its own label and the line that says why", () => {
    const { rerender } = render(
      <ThreadCard
        now={NOW}
        thread={makeThread({ status: "queued", liveStatusLine: "Waiting for a free run slot" })}
      />,
    );
    expect(card().getAttribute("data-status")).toBe("queued");
    expect(screen.getByTestId("thread-status-label").textContent).toBe("Queued");
    expect(screen.getByTestId("thread-status-line").textContent).toBe(
      "Waiting for a free run slot",
    );

    rerender(
      <ThreadCard
        now={NOW}
        thread={makeThread({
          status: "rate-limited",
          liveStatusLine:
            "Paused: You've hit your session limit. Resuming automatically at 3:45 PM.",
        })}
      />,
    );
    expect(card().getAttribute("data-status")).toBe("rate-limited");
    expect(screen.getByTestId("thread-status-label").textContent).toBe("Rate limited");
    expect(screen.getByTestId("thread-status-line").textContent).toContain(
      "Resuming automatically",
    );
  });

  test("a resolved thread reads as closed", () => {
    render(<ThreadCard now={NOW} thread={makeThread({ status: "resolved" })} />);
    expect(card().className).toContain("opacity-70");
  });
});

describe("Resume on a rate-limited card", () => {
  let host: ReturnType<typeof mockHost>;
  beforeEach(() => {
    host = mockHost();
    host.respondWith(() => json({ thread: makeThread({ status: "working" }) }));
  });
  afterEach(() => host.restore());

  test("a rate-limited thread's card has a Resume button; no other card has one", () => {
    const { rerender } = render(
      <ThreadCard now={NOW} thread={makeThread({ status: "rate-limited" })} />,
    );
    expect(within(card()).getByTestId("thread-card-resume")).toBeTruthy();

    for (const status of ["working", "queued", "idle", "waiting-on-you"] as const) {
      rerender(<ThreadCard now={NOW} thread={makeThread({ status })} />);
      expect(screen.queryByTestId("thread-card-resume")).toBeNull();
    }
  });

  test("Resume ends the wait and does not open the thread", async () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({ id: "thr_9", projectId: "p1", status: "rate-limited" })}
      />,
    );

    fireEvent.click(screen.getByTestId("thread-card-resume"));

    await waitFor(() => expect(host.to("/api/threads/thr_9/resume", "POST")).toHaveLength(1));
    expect(window.location.pathname).toBe("/");
  });
});
