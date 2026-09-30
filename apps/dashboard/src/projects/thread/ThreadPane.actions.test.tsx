import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { SessionDiffFile, SessionGitDiff } from "@aop/common";
import { toast } from "sonner";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import { hostError, json, mockHost } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, waitFor } = await import("@testing-library/react");
const { EMPTY_DIFF, flush, setupPane } = await import("./pane-test-harness");

let host: ReturnType<typeof mockHost>;
let failure: ReturnType<typeof spyOn<typeof toast, "error">>;

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { get: () => state, configurable: true });

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
  setVisibility("visible");
  host = mockHost();
  failure = spyOn(toast, "error").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  host.restore();
  failure.mockRestore();
  setVisibility("visible");
});

const NOTES: SessionDiffFile = {
  path: "NOTES.md",
  oldPath: null,
  status: "added",
  additions: 0,
  deletions: 0,
  truncated: false,
  hunks: [],
  detailsPending: true,
};

const NOTES_BODY: SessionDiffFile = {
  ...NOTES,
  additions: 1,
  detailsPending: undefined,
  hunks: [
    { oldStart: 0, newStart: 1, lines: [{ type: "add", oldNo: null, newNo: 1, text: "hello" }] },
  ],
};

const CHANGED: SessionGitDiff = { ...EMPTY_DIFF, files: [NOTES] };
const fileRequests = () => host.to("/api/threads/thr_1/diff/file?path=NOTES.md", "GET");

describe("the Changes tab", () => {
  test("counts the changed files, and reads no file until the tab is opened", async () => {
    await setupPane(host, { diff: CHANGED });

    expect(screen.getByTestId("thread-tab-transcript").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("thread-tab-changes-count").textContent).toBe("1");
    expect(screen.queryByTestId("thread-changes")).toBeNull();
    expect(fileRequests()).toHaveLength(0);
  });

  test("shows no count for a thread that changed nothing", async () => {
    await setupPane(host);

    expect(screen.queryByTestId("thread-tab-changes-count")).toBeNull();
  });

  test("opens onto the files, and reads each one's lines once", async () => {
    await setupPane(host, {
      diff: CHANGED,
      answers: { "GET /api/threads/thr_1/diff/file?path=NOTES.md": () => json(NOTES_BODY) },
    });

    fireEvent.click(screen.getByTestId("thread-tab-changes"));
    await flush();

    expect(screen.getByTestId("thread-tab-changes").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("thread-diff-file").getAttribute("data-path")).toBe("NOTES.md");
    expect(screen.getByTestId("thread-diff-line").textContent).toContain("hello");
    expect(fileRequests()).toHaveLength(1);
  });

  test("keeps the conversation mounted behind it, so a draft survives the round trip", async () => {
    await setupPane(host, {
      diff: CHANGED,
      answers: { "GET /api/threads/thr_1/diff/file?path=NOTES.md": () => json(NOTES_BODY) },
    });
    const box = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "half a thought" } });

    fireEvent.click(screen.getByTestId("thread-tab-changes"));
    await flush();
    expect(screen.getByTestId("thread-changes")).toBeTruthy();
    fireEvent.click(screen.getByTestId("thread-tab-transcript"));
    await flush();

    expect(screen.queryByTestId("thread-changes")).toBeNull();
    expect(screen.getByTestId("composer-input")).toBe(box);
    expect(box.value).toBe("half a thought");
  });

  test("says why there are no changes when the host cannot show them", async () => {
    await setupPane(host, {
      answers: {
        "GET /api/threads/thr_1/diff": () =>
          hostError(409, "WORKTREE_FAILED", "The thread's git worktree failed: it is locked"),
      },
    });

    fireEvent.click(screen.getByTestId("thread-tab-changes"));
    await flush();

    expect(screen.getByTestId("thread-diff-unavailable").textContent).toBe(
      "The thread's git worktree failed: it is locked",
    );
  });

  test("a resolved thread explains that its worktree is gone", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "resolved" }),
      answers: {
        "GET /api/threads/thr_1/diff": () =>
          hostError(409, "WORKTREE_FAILED", "Bound chat workspace does not exist: /x"),
      },
    });

    fireEvent.click(screen.getByTestId("thread-tab-changes"));
    await flush();

    expect(screen.getByTestId("thread-diff-unavailable").textContent).toContain("worktree is gone");
    expect(screen.getByTestId("thread-diff-unavailable").textContent).not.toContain("/x");
  });

  test("reads the changes again when a turn ends", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
    });
    expect(host.to("/api/threads/thr_1/diff", "GET")).toHaveLength(1);

    await stream.setThread(makeThread({ id: "thr_1", status: "idle" }));

    expect(host.to("/api/threads/thr_1/diff", "GET")).toHaveLength(2);
  });
});

describe("reading a thread", () => {
  const readRequests = () => host.to("/api/threads/thr_1/read", "POST");

  test("an unread thread is marked read as it opens, once", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", unread: true }) });

    expect(readRequests()).toHaveLength(1);
  });

  test("a thread already read is left alone", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", unread: false }) });

    expect(readRequests()).toHaveLength(0);
  });

  test("a page nobody is looking at does not count as reading, until it is looked at", async () => {
    setVisibility("hidden");
    await setupPane(host, { thread: makeThread({ id: "thr_1", unread: true }) });
    expect(readRequests()).toHaveLength(0);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(readRequests()).toHaveLength(1);
  });

  test("a reply that arrives while the thread is open is read as it comes", async () => {
    const stream = await setupPane(host, { thread: makeThread({ id: "thr_1", unread: false }) });
    expect(readRequests()).toHaveLength(0);

    await stream.setThread(makeThread({ id: "thr_1", unread: true }));

    expect(readRequests()).toHaveLength(1);
  });
});

describe("the thread menu", () => {
  const open = async () => {
    fireEvent.pointerDown(screen.getByTestId("thread-menu"), { button: 0, ctrlKey: false });
    await screen.findByTestId("thread-menu-content");
  };
  const isDisabled = () => screen.getByTestId("thread-resolve").getAttribute("aria-disabled");

  test.each(["idle", "ready-for-review", "waiting-on-you"] as const)(
    "a %s thread can be marked resolved",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });
      await open();

      expect(isDisabled()).toBeNull();
      fireEvent.click(screen.getByTestId("thread-resolve"));
      await flush();

      expect(host.to("/api/threads/thr_1/resolve", "POST")).toHaveLength(1);
    },
  );

  test.each(["working", "queued", "rate-limited", "landing", "resolved"] as const)(
    "a %s thread cannot be: the host would refuse, so the item is disabled",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });
      await open();

      expect(isDisabled()).toBe("true");
      fireEvent.click(screen.getByTestId("thread-resolve"));
      await flush();

      expect(host.to("/api/threads/thr_1/resolve", "POST")).toHaveLength(0);
    },
  );

  test("a refused resolve is a toast with the host's sentence", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle" }),
      answers: {
        "POST /api/threads/thr_1/resolve": () =>
          hostError(409, "THREAD_BUSY", "The thread is busy: a turn is running"),
      },
    });
    await open();

    fireEvent.click(screen.getByTestId("thread-resolve"));
    await flush();

    expect(failure).toHaveBeenCalledWith("The thread is busy: a turn is running");
  });

  test("Delete asks first, and cancelling deletes nothing", async () => {
    await setupPane(host);
    await open();

    fireEvent.click(screen.getByTestId("thread-delete"));
    expect(
      (await screen.findAllByText(/Delete “Fix 4s cold start regression”\?/)).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Cancel"));
    await flush();

    expect(host.to("/api/threads/thr_1", "DELETE")).toHaveLength(0);
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1");
  });

  test("a confirmed delete removes the thread and leaves its pane for the project", async () => {
    await setupPane(host);
    await open();

    fireEvent.click(screen.getByTestId("thread-delete"));
    await screen.findAllByText(/Delete “Fix 4s cold start regression”\?/);
    fireEvent.click(screen.getByText("Delete thread"));

    await waitFor(() => expect(host.to("/api/threads/thr_1", "DELETE")).toHaveLength(1));
    expect(window.location.pathname).toBe("/projects/prj_1");
  });
});
