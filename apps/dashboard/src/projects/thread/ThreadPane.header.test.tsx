import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { userMessage } from "../chat/test-utils";
import { makeThread } from "../test-utils";
import { mockHost } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, waitFor } = await import("@testing-library/react");
const { EMPTY_DIFF, setupPane } = await import("./pane-test-harness");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
});

describe("the header", () => {
  const openDetails = async () => {
    fireEvent.click(screen.getByTestId("thread-title"));
    return screen.findByTestId("thread-details");
  };
  const CHANGED = {
    ...EMPTY_DIFF,
    files: [
      {
        path: "NOTES.md",
        oldPath: null,
        status: "added" as const,
        additions: 1,
        deletions: 0,
        truncated: false,
        hunks: [],
        detailsPending: true,
      },
    ],
  };

  test("is one 56px row: the title cut to one line with all of it in the tooltip, and the buttons", async () => {
    const title = "Survey the umbral repository and report its current state in a long title";
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", title, status: "working", branch: "aop/a-long-branch" }),
    });

    const header = screen.getByTestId("thread-header");
    expect(header.className).toContain("h-14");
    const heading = screen.getByTestId("thread-title");
    expect(heading.textContent).toBe(title);
    expect(heading.className).toContain("truncate");
    expect(heading.getAttribute("title")).toBe(title);
    expect(header.contains(screen.getByTestId("thread-resolve-button"))).toBe(true);
    expect(header.contains(screen.getByTestId("thread-menu"))).toBe(true);
    // No meta line and no tabs under it: the conversation starts right below.
    expect(screen.queryByTestId("thread-meta")).toBeNull();
    expect(screen.queryByTestId("thread-status")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Thread" })).toBeNull();
  });

  test("the title opens the rest: the whole title, the status, the repository, the branch and the age", async () => {
    await setupPane(host, {
      thread: makeThread({
        id: "thr_1",
        title: "Fix 4s cold start regression",
        status: "idle",
        branch: "aop/fix-cold-start-ab12cd",
      }),
    });

    const details = await openDetails();

    expect(details.textContent).toContain("Fix 4s cold start regression");
    expect(screen.getByTestId("thread-status").textContent).toBe("Idle");
    expect(screen.getByTestId("thread-details-branch").textContent).toBe(
      "aop/fix-cold-start-ab12cd",
    );
    expect(screen.getByTestId("thread-repo").textContent).toBe("checkout");
    expect(screen.getByTestId("thread-age").textContent).toMatch(/^Active /);
  });

  test("the pull request bar sits just above the box that steers the thread", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle", branch: "aop/notes-ab12cd" }),
      diff: CHANGED,
    });

    const dock = screen.getByTestId("thread-dock");
    expect(dock.contains(screen.getByTestId("pr-bar"))).toBe(true);
    expect(dock.nextElementSibling).toBe(screen.getByTestId("composer"));
    expect(screen.getByTestId("pr-bar").contains(screen.getByTestId("thread-branch"))).toBe(true);
    expect(screen.getByTestId("thread-header").contains(screen.getByTestId("pr-bar"))).toBe(false);
  });

  test("the cross sends the bar away and the thread's menu brings it back", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle", branch: "aop/notes-ab12cd" }),
      diff: CHANGED,
    });

    fireEvent.click(screen.getByTestId("pr-bar-hide"));
    expect(screen.queryByTestId("pr-bar")).toBeNull();

    fireEvent.pointerDown(screen.getByTestId("thread-menu"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("thread-show-pr-bar"));
    expect(screen.getByTestId("pr-bar")).toBeTruthy();
  });

  test("a thread with a pull request cannot have its bar sent away", async () => {
    await setupPane(host, {
      thread: makeThread({
        id: "thr_1",
        status: "ready-for-review",
        branch: "aop/notes-ab12cd",
        artifacts: [
          { type: "pr", number: 7, url: "https://github.com/acme/app/pull/7", state: "open" },
        ],
      }),
    });

    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("open");
    expect(screen.queryByTestId("pr-bar-hide")).toBeNull();
  });

  test("the checklist is a card in the conversation and scrolls with it, so it cannot cover a line of it", async () => {
    await setupPane(host, {
      thread: makeThread({
        id: "thr_1",
        status: "working",
        steps: [
          { label: "Read the repository", state: "done" },
          { label: "Write the report", state: "active" },
        ],
      }),
      messages: [userMessage("m1", 1, { threadId: "thr_1" })],
    });

    const scroller = screen.getByTestId("chat-scroll");
    const checklist = screen.getByTestId("thread-progress");
    expect(scroller.contains(checklist)).toBe(true);
    expect(checklist.className).toContain("border");
    expect(checklist.className).not.toContain("sticky");
  });

  test("a repository the host does not list is shown by its id", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", repoId: "repo_gone" }) });
    await openDetails();

    await waitFor(() => expect(screen.getByTestId("thread-repo").textContent).toBe("repo_gone"));
  });

  test("the way back leads to the project's threads without a page load", async () => {
    await setupPane(host);

    const back = screen.getByTestId("thread-back");
    expect(back.getAttribute("href")).toBe("/projects/prj_1");
    fireEvent.click(back);
    expect(window.location.pathname).toBe("/projects/prj_1");
  });

  test("a thread waiting on you says so in the attention colour", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "waiting-on-you" }) });
    await openDetails();

    expect(screen.getByTestId("thread-status").textContent).toBe("Waiting on you");
    expect(screen.getByTestId("thread-status").className).toContain("text-waiting");
    expect(screen.getByTestId("thread-pane").getAttribute("data-status")).toBe("waiting-on-you");
  });

  test("a thread with no repository has no repository, branch or pull request bar", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", repoId: null, branch: null }),
      diff: CHANGED,
    });
    await openDetails();

    expect(screen.queryByTestId("thread-repo")).toBeNull();
    expect(screen.queryByTestId("thread-details-branch")).toBeNull();
    expect(screen.queryByTestId("pr-bar")).toBeNull();
  });
});
