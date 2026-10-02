import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Artifact } from "@aop/common";
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

type PullRequest = Extract<Artifact, { type: "pr" }>;

const openPr = (checks?: {
  state: "failure" | "pending" | "success";
  failing: number;
}): PullRequest => ({
  type: "pr",
  number: 7,
  url: "https://github.com/acme/app/pull/7",
  state: "open",
  ...(checks && { checks: { successful: 1, pending: 0, ...checks } }),
});

describe("a stopped thread whose pull request fails its checks", () => {
  const dot = () => screen.getByTestId("thread-status-dot");

  test("is not drawn as ready: an alert label and dot, whether it is ready for review or idle", () => {
    for (const status of ["ready-for-review", "idle"] as const) {
      render(
        <ThreadCard
          now={NOW}
          thread={makeThread({ status, artifacts: [openPr({ state: "failure", failing: 2 })] })}
        />,
      );

      expect(card().getAttribute("data-checks-failing")).toBe("true");
      expect(screen.getByTestId("thread-status-label").textContent).toBe("Checks failing");
      expect(screen.getByTestId("thread-status-label").className).toContain("text-blocked");
      expect(dot().className).toContain("bg-blocked");
      expect(dot().className).not.toContain("bg-ok");
      expect(card().className).toContain("border-blocked");
      cleanup();
    }
  });

  test("keeps its own look when the checks pass, are running, or are not known, and when it is working, merged or resolved", () => {
    const cases: Parameters<typeof makeThread>[0][] = [
      { status: "ready-for-review", artifacts: [openPr({ state: "success", failing: 0 })] },
      { status: "ready-for-review", artifacts: [openPr({ state: "pending", failing: 0 })] },
      { status: "ready-for-review", artifacts: [openPr()] },
      { status: "working", artifacts: [openPr({ state: "failure", failing: 1 })] },
      { status: "resolved", artifacts: [openPr({ state: "failure", failing: 1 })] },
      {
        status: "ready-for-review",
        artifacts: [{ ...openPr({ state: "failure", failing: 1 }), state: "merged" }],
      },
    ];
    for (const overrides of cases) {
      render(<ThreadCard now={NOW} thread={makeThread(overrides)} />);

      expect(card().getAttribute("data-checks-failing")).toBeNull();
      expect(screen.getByTestId("thread-status-label").textContent).not.toBe("Checks failing");
      expect(dot().className).not.toContain("bg-blocked");
      cleanup();
    }
  });
});

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

  test("a status line written in markdown shows as plain text", () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({ status: "idle", liveStatusLine: "You chose **formal**. No `diff`." })}
      />,
    );

    expect(screen.getByTestId("thread-status-line").textContent).toBe("You chose formal. No diff.");
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
    expect(screen.getByTestId("thread-card-link").className).toContain("font-semibold");
    expect(screen.getByTestId("thread-card-link").textContent).toContain("Unread");
    // One leading dot: the status dot. Unread is not a second one.
    expect(card().querySelectorAll("[data-testid='thread-status-dot']").length).toBe(1);
    expect(card().querySelector("[data-testid='thread-unread-dot']")).toBeNull();

    cleanup();
    render(<ThreadCard now={NOW} thread={makeThread({ unread: false })} />);
    expect(screen.getByTestId("thread-card-link").className).not.toContain("font-semibold");
    expect(screen.getByTestId("thread-card-link").textContent).not.toContain("Unread");
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
    // The branch is in the thread's header, not on the overview row.
    expect(within(card()).queryByText("aop/cold-start")).toBeNull();
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

describe("a working thread that needs the person", () => {
  const waitingOn = {
    reason: "Approve the production deployment on GitHub",
    link: "https://github.com/get-aop/aop-web/actions/runs/1",
    since: AT,
  };

  test("waiting on them for something outside AOP, it looks like a thread waiting on them, with the reason and where to act", () => {
    render(<ThreadCard now={NOW} thread={makeThread({ status: "working", waitingOn })} />);

    expect(card().getAttribute("data-status")).toBe("working");
    expect(card().getAttribute("data-shown-status")).toBe("waiting-on-you");
    expect(card().className).toContain("border-waiting");
    expect(screen.getByTestId("thread-status-dot").className).toContain("bg-waiting");
    expect(screen.getByTestId("thread-status-label").textContent).toBe("Waiting on you");
    expect(screen.getByTestId("thread-status-line").textContent).toBe(
      "Needs you · Approve the production deployment on GitHub",
    );
    const link = screen.getByTestId("thread-wait-link");
    expect(link.getAttribute("href")).toBe(waitingOn.link);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("github.com");
  });

  test("whose AOP tools are lost, it says so in red ahead of anything else", () => {
    render(
      <ThreadCard
        now={NOW}
        thread={makeThread({
          status: "working",
          waitingOn,
          degraded: { reason: "Its call failed before it reached the host.", since: AT },
        })}
      />,
    );

    expect(card().getAttribute("data-degraded")).toBe("true");
    expect(screen.getByTestId("thread-status-line").textContent).toBe(
      "AOP tools lost · Its call failed before it reached the host.",
    );
    expect(screen.getByTestId("thread-status-line").innerHTML).toContain("text-blocked");
  });
});
