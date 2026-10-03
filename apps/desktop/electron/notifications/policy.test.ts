import { describe, expect, test } from "bun:test";
import type { NotificationLevel, Thread } from "@aop/common";
import {
  decideNotification,
  type NotificationIntent,
  notificationPath,
  type PolicyContext,
  STALE_AFTER_MS,
} from "./policy";
import {
  coordinatorPost,
  entryFor,
  JUST_NOW,
  LONG_AGO,
  makeProject,
  makeThread,
  NOW,
  pullRequest,
  threadReport,
  waitingThread,
} from "./test-utils";

const contextFor = (
  overrides: Partial<PolicyContext> = {},
  level: NotificationLevel = "coordinator",
) => ({
  project: makeProject({ notificationLevel: level }),
  previousThread: undefined,
  threadTitle: (id: string) => (id === "thr_1" ? "Fix the cold start" : undefined),
  now: NOW,
  appFocused: false,
  ...overrides,
});

const decide = (
  entry: Parameters<typeof decideNotification>[0],
  overrides: Partial<PolicyContext> = {},
  level: NotificationLevel = "coordinator",
): NotificationIntent | null => decideNotification(entry, contextFor(overrides, level));

describe("a thread that needs the person", () => {
  test("notifies once, naming the thread and its question, and opens that thread", () => {
    const asks = waitingThread("Upgrade the Lambda, or pin the version?");

    expect(decide(entryFor({ thread: asks }), { previousThread: makeThread() })).toEqual({
      kind: "needs-you",
      title: "checkout-service",
      body: "Fix the cold start · Upgrade the Lambda, or pin the version?",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
  });

  test("notifies for a thread it has not seen before", () => {
    expect(decide(entryFor({ thread: waitingThread() }))?.kind).toBe("needs-you");
  });

  test("does not repeat itself while the same question stays open", () => {
    const asks = waitingThread("Which one?");

    expect(decide(entryFor({ thread: asks }), { previousThread: asks })).toBeNull();
    expect(
      decide(entryFor({ thread: { ...asks, unread: true } }), { previousThread: asks }),
    ).toBeNull();
  });

  test("notifies again for a new question from the same thread", () => {
    const first = waitingThread("Which database?");
    const second = waitingThread("Which region?");

    expect(decide(entryFor({ thread: second }), { previousThread: first })?.body).toContain(
      "Which region?",
    );
  });

  test("is not announced a second time by the report that the thread needs the person", () => {
    expect(decide(entryFor({ message: threadReport("needs-you") }))).toBeNull();
  });
});

describe("a working thread that needs the person", () => {
  const waitingOn = {
    reason: "Approve the production deployment",
    link: "https://github.com/acme/app/actions/runs/1",
    since: JUST_NOW,
  };

  test("notifies once when it starts waiting on the person outside AOP", () => {
    const waits = makeThread({ waitingOn });

    expect(decide(entryFor({ thread: waits }), { previousThread: makeThread() })).toEqual({
      kind: "needs-you",
      title: "checkout-service",
      body: "Fix the cold start · Approve the production deployment",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
    expect(decide(entryFor({ thread: waits }), { previousThread: waits })).toBeNull();
  });

  test("notifies when its AOP tools stop reaching the host, once", () => {
    const lost = makeThread({ degraded: { reason: "Its call failed.", since: JUST_NOW } });

    expect(decide(entryFor({ thread: lost }), { previousThread: makeThread() })).toEqual({
      kind: "thread-error",
      title: "checkout-service",
      body: "Fix the cold start lost its AOP tools",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
    expect(decide(entryFor({ thread: lost }), { previousThread: lost })).toBeNull();
  });
});

describe("a thread that failed", () => {
  test("notifies with the thread's title and what went wrong", () => {
    expect(decide(entryFor({ message: threadReport("failed", "The build broke.") }))).toEqual({
      kind: "thread-error",
      title: "checkout-service",
      body: "Fix the cold start failed: The build broke.",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
  });

  test("still notifies when the thread's title is unknown", () => {
    const intent = decide(entryFor({ message: threadReport("failed", "Oops.") }), {
      threadTitle: () => undefined,
    });

    expect(intent?.body).toBe("A thread failed: Oops.");
  });
});

describe("the coordinator", () => {
  test("notifies with the start of what it said, and opens the coordinator chat", () => {
    expect(decide(entryFor({ message: coordinatorPost("Two threads are running.") }))).toEqual({
      kind: "coordinator",
      title: "checkout-service",
      body: "Two threads are running.",
      target: { projectId: "prj_1", threadId: null },
    });
  });

  test("says something even when its reply has no prose", () => {
    const cardsOnly = coordinatorPost("x", {
      blocks: [{ type: "routing-receipt", threadIds: ["thread-1", "thread-2"] }],
    });

    expect(decide(entryFor({ message: cardsOnly }))?.body).toBe(
      "The coordinator posted an update.",
    );
  });

  test("announces a reply that asks the person something by its question", () => {
    const asking = coordinatorPost("The checkout thread is done.", {
      blocks: [
        { type: "text", text: "The checkout thread is done." },
        {
          type: "question",
          question: "Merge it by itself, or wait for you?",
          options: [{ label: "Merge by itself" }, { label: "Wait for me" }],
          other: false,
        },
      ],
    });

    expect(decide(entryFor({ message: asking }))?.body).toBe(
      "Merge it by itself, or wait for you?",
    );
  });

  test("keeps a long reply to one short line", () => {
    const body = decide(
      entryFor({ message: coordinatorPost(`${"word ".repeat(200)}\n\nmore`) }),
    )?.body;

    expect(body?.length).toBeLessThanOrEqual(180);
    expect(body?.endsWith("…")).toBe(true);
    expect(body).not.toContain("\n");
  });

  test("does not announce a thread's own assistant messages", () => {
    expect(
      decide(entryFor({ message: coordinatorPost("Working.", { threadId: "thr_1" }) })),
    ).toBeNull();
  });

  test("does not announce what the person typed", () => {
    const typed = coordinatorPost("x", { role: "user", text: "Fix it", blocks: undefined });

    expect(decide(entryFor({ message: typed }))).toBeNull();
  });

  test("does not announce what the coordinator sends a thread: its own chat already says so", () => {
    for (const brief of [true, undefined]) {
      const sent = coordinatorPost("x", {
        role: "user",
        threadId: "thr_1",
        sender: "coordinator",
        text: "Fix the login redirect.",
        blocks: undefined,
        ...(brief && { brief }),
      });

      expect(decide(entryFor({ message: sent }))).toBeNull();
    }
  });
});

describe("pull requests", () => {
  const withPr = (state: "open" | "merged" | "closed"): Thread =>
    makeThread({ status: "idle", artifacts: [pullRequest(state)] });

  test("notifies when the pull request lands", () => {
    expect(
      decide(entryFor({ thread: withPr("merged") }), { previousThread: withPr("open") }),
    ).toEqual({
      kind: "pr-merged",
      title: "checkout-service",
      body: "PR #4821 merged · Fix the cold start",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
  });

  test("notifies when the pull request is closed without merging", () => {
    expect(
      decide(entryFor({ thread: withPr("closed") }), { previousThread: withPr("open") })?.body,
    ).toBe("PR #4821 was closed without merging · Fix the cold start");
  });

  test("says nothing about a pull request it first sees already finished, or that did not change", () => {
    expect(decide(entryFor({ thread: withPr("merged") }))).toBeNull();
    expect(
      decide(entryFor({ thread: withPr("merged") }), { previousThread: withPr("merged") }),
    ).toBeNull();
    expect(
      decide(entryFor({ thread: withPr("open") }), { previousThread: withPr("open") }),
    ).toBeNull();
  });
});

describe("the notification level", () => {
  test("off is silence for everything", () => {
    for (const payload of [
      { thread: waitingThread() },
      { message: threadReport("failed") },
      { message: coordinatorPost() },
    ]) {
      expect(decide(entryFor(payload), {}, "off")).toBeNull();
    }
  });

  test("every-turn adds a finished turn, which the default level does not announce", () => {
    const finished = entryFor({ message: threadReport("finished") });

    expect(decide(finished, {}, "coordinator")).toBeNull();
    expect(decide(finished, {}, "every-turn")).toEqual({
      kind: "turn-finished",
      title: "checkout-service",
      body: "Fix the cold start finished a turn",
      target: { projectId: "prj_1", threadId: "thr_1" },
    });
  });

  test("every-turn keeps everything the default level announces", () => {
    expect(decide(entryFor({ thread: waitingThread() }), {}, "every-turn")?.kind).toBe("needs-you");
    expect(decide(entryFor({ message: coordinatorPost() }), {}, "every-turn")?.kind).toBe(
      "coordinator",
    );
  });

  test("a project that is paused or archived does not notify", () => {
    for (const status of ["paused", "archived"] as const) {
      expect(
        decide(entryFor({ thread: waitingThread() }), { project: makeProject({ status }) }),
      ).toBeNull();
    }
  });
});

describe("when not to bother the person", () => {
  test("stays quiet while the person is looking at the app", () => {
    expect(decide(entryFor({ thread: waitingThread() }), { appFocused: true })).toBeNull();
  });

  test("treats what is older than a couple of minutes as history", () => {
    const stale = new Date(NOW - STALE_AFTER_MS - 1000).toISOString();
    const fresh = new Date(NOW - STALE_AFTER_MS + 1000).toISOString();

    expect(
      decide(entryFor({ thread: waitingThread(undefined, { lastActivityAt: stale }) })),
    ).toBeNull();
    expect(
      decide(entryFor({ message: coordinatorPost("Old news.", { createdAt: LONG_AGO }) })),
    ).toBeNull();
    expect(
      decide(entryFor({ thread: waitingThread(undefined, { lastActivityAt: fresh }) }))?.kind,
    ).toBe("needs-you");
  });

  test("ignores entries that carry no news", () => {
    expect(decide(entryFor({ project: makeProject() }))).toBeNull();
    expect(decide(entryFor({ threadId: "thr_1" }))).toBeNull();
    expect(decide(entryFor({}))).toBeNull();
    expect(decide(entryFor({ thread: makeThread({ status: "working" }) }))).toBeNull();
  });
});

describe("notificationPath", () => {
  test("opens a thread, or the coordinator chat, in the dashboard's own routes", () => {
    expect(notificationPath({ projectId: "prj_1", threadId: "thr_9" })).toBe(
      "/projects/prj_1/threads/thr_9",
    );
    expect(notificationPath({ projectId: "prj_1", threadId: null })).toBe("/projects/prj_1/chat");
  });

  test("encodes ids so nothing they contain can change the path", () => {
    expect(notificationPath({ projectId: "a/b", threadId: "c d?e" })).toBe(
      "/projects/a%2Fb/threads/c%20d%3Fe",
    );
  });
});
