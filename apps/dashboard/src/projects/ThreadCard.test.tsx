import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { AT, makeThread } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
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
