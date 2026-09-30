import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { hostError, json, mockHost } from "../projects/thread/test-utils";
import type * as ThreadsApi from "./threads";

// The module under a query-string suffix, so a mock.module registration for it in another test
// file can never leak in here (bun's mock.module is process-wide). Not so for `request`: an
// ApiError must be the class the functions below throw.
const { ApiError } = await import("./request");
const {
  deleteThread,
  getThreadActivity,
  getThreadDiff,
  getThreadDiffFile,
  getThreadUsage,
  listThreadMessages,
  markThreadRead,
  mergeThreadPullRequest,
  openThreadPullRequest,
  replyToThread,
  resolveThread,
  resumeThread,
  steerThread,
  stopThread,
  syncThreadPullRequest,
} = (await import("./threads" + "?api-threads-test")) as typeof ThreadsApi;

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  host = mockHost();
});

afterEach(() => {
  host.restore();
});

const thread = { id: "thr 1", title: "Fix login" };

describe("reading", () => {
  test("lists a thread's messages, with its id encoded in the path", async () => {
    host.respondWith(() => json({ messages: [{ id: "m1" }] }));

    expect(await listThreadMessages("thr 1")).toEqual([{ id: "m1" }] as never);
    expect(host.requests).toEqual([
      { method: "GET", url: "/api/threads/thr%201/messages", body: undefined },
    ]);
  });

  test("reads the changed files as the host lists them", async () => {
    const diff = { defaultBranch: "main", files: [], perFileLineCap: 2000, summaryOnly: true };
    host.respondWith(() => json(diff));

    expect(await getThreadDiff("thr_1")).toEqual(diff);
    expect(host.requests).toEqual([
      { method: "GET", url: "/api/threads/thr_1/diff", body: undefined },
    ]);
  });

  test("reads one file's lines, with its path encoded into the query", async () => {
    const file = { path: "src/a b&c.ts", hunks: [] };
    host.respondWith(() => json(file));

    expect(await getThreadDiffFile("thr_1", "src/a b&c.ts")).toEqual(file as never);
    expect(host.requests).toEqual([
      {
        method: "GET",
        url: "/api/threads/thr_1/diff/file?path=src%2Fa%20b%26c.ts",
        body: undefined,
      },
    ]);
  });

  test("reads the tool calls of the thread's turns", async () => {
    host.respondWith(() => json({ turns: [] }));

    expect(await getThreadActivity("thr 1")).toEqual({ turns: [] });
    expect(host.requests).toEqual([
      { method: "GET", url: "/api/threads/thr%201/activity", body: undefined },
    ]);
  });

  test("reads what the thread's runs consumed from the usage route, not the thread route", async () => {
    const usage = { threadId: "thr 1", totals: { runs: 2 } };
    host.respondWith(() => json(usage));

    expect(await getThreadUsage("thr 1")).toEqual(usage as never);
    expect(host.requests).toEqual([
      { method: "GET", url: "/api/usage/threads/thr%201", body: undefined },
    ]);
  });
});

describe("messages to a thread", () => {
  test("steering posts the text and returns the thread", async () => {
    host.respondWith(() => json({ thread }, 201));

    expect(await steerThread("thr 1", "use Postgres")).toEqual(thread as never);
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr%201/messages", body: { text: "use Postgres" } },
    ]);
  });

  test("answering posts the text to the reply route", async () => {
    host.respondWith(() => json({ thread }));

    expect(await replyToThread("thr 1", "SQLite")).toEqual(thread as never);
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr%201/reply", body: { text: "SQLite" } },
    ]);
  });
});

describe("what a person does to a thread", () => {
  test.each([
    ["stop", stopThread, "/api/threads/thr%201/stop"],
    ["resume", resumeThread, "/api/threads/thr%201/resume"],
    ["resolve", resolveThread, "/api/threads/thr%201/resolve"],
    ["mark read", markThreadRead, "/api/threads/thr%201/read"],
    ["sync the pull request", syncThreadPullRequest, "/api/threads/thr%201/pull-request/sync"],
  ] as const)("%s posts with no body and returns the thread", async (_name, call, url) => {
    host.respondWith(() => json({ thread }));

    expect(await call("thr 1")).toEqual(thread as never);
    expect(host.requests).toEqual([{ method: "POST", url, body: undefined }]);
  });

  test("deleting sends DELETE and is done when the host answers with nothing", async () => {
    host.respondWith(() => new Response(null, { status: 204 }));

    expect(await deleteThread("thr 1")).toBeUndefined();
    expect(host.requests).toEqual([
      { method: "DELETE", url: "/api/threads/thr%201", body: undefined },
    ]);
  });
});

describe("the thread's pull request", () => {
  test("opening sends an empty body by default and returns what the host did", async () => {
    const opened = {
      thread,
      pullRequest: { number: 7, url: "https://github.com/acme/app/pull/7", state: "open" },
      created: true,
    };
    host.respondWith(() => json(opened, 201));

    expect(await openThreadPullRequest("thr 1")).toEqual(opened as never);
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr%201/pull-request", body: {} },
    ]);
  });

  test("opening as a draft says so", async () => {
    host.respondWith(() => json({ thread, pullRequest: {}, created: true }, 201));

    await openThreadPullRequest("thr_1", { draft: true });

    expect(host.requests[0]?.body).toEqual({ draft: true });
  });

  test("merging without a method sends no body: the host squashes", async () => {
    host.respondWith(() => json({ thread }));

    expect(await mergeThreadPullRequest("thr 1")).toEqual(thread as never);
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr%201/pull-request/merge", body: undefined },
    ]);
  });

  test("merging with a method names it", async () => {
    host.respondWith(() => json({ thread }));

    await mergeThreadPullRequest("thr_1", "rebase");

    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/pull-request/merge", body: { method: "rebase" } },
    ]);
  });
});

describe("when the host refuses", () => {
  test("a 409 throws an ApiError with the host's code and its own sentence", async () => {
    host.respondWith(() =>
      hostError(409, "UNPUBLISHED_WORK", "The thread has work its pull request does not include"),
    );

    const failure = await mergeThreadPullRequest("thr_1", "squash").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      code: "UNPUBLISHED_WORK",
      message: "The thread has work its pull request does not include",
    });
  });

  test("a read refused for a worktree that is gone carries the same", async () => {
    host.respondWith(() => hostError(409, "WORKTREE_FAILED", "The worktree is gone"));

    await expect(getThreadDiff("thr_1")).rejects.toMatchObject({
      status: 409,
      code: "WORKTREE_FAILED",
      message: "The worktree is gone",
    });
  });

  test("an unknown thread is a 404", async () => {
    host.respondWith(() => hostError(404, "THREAD_NOT_FOUND", "Thread not found"));

    await expect(stopThread("thr_x")).rejects.toMatchObject({
      status: 404,
      code: "THREAD_NOT_FOUND",
    });
  });
});
