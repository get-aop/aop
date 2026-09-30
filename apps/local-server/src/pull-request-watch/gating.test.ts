import { describe, expect, test } from "bun:test";
import { reloadThread } from "../thread/pr-test-utils.ts";
import {
  fixPrompts,
  ledgerOf,
  MINUTE,
  openedThread,
  reportsToCoordinator,
  useWatchWorld,
  type WatchWorld,
} from "./test-utils.ts";
import { createPullRequestWatcher } from "./watcher.ts";

const world = useWatchWorld();

const failingWith = async (w: WatchWorld, options: Parameters<typeof openedThread>[1] = {}) => {
  const opened = await openedThread(w, options);
  w.github.ci.setChecks(opened.number, "fail");
  return opened;
};

describe("a thread that is not at rest is not interrupted", () => {
  test("one that is working is asked once its turn is over, with the same failing run", async () => {
    const w = await world.setup();
    const { thread } = await failingWith(w);
    await w.s.services.threads.send(thread.id, "carry on [fake: startup=1200]");
    expect((await reloadThread(w.s, thread.id)).status).toBe("working");

    await w.watcher.tick();
    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect(await ledgerOf(w, thread.id)).toEqual([]);

    await w.s.settle();
    await w.tick(MINUTE);
    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });

  test("one that asked the person a question keeps it, and is asked once it is answered", async () => {
    // The question is a call to the AOP MCP tool, so the run needs a server to reach.
    const w = await world.setup({ mcp: true });
    const { thread } = await failingWith(w);
    await w.s.services.threads.send(thread.id, 'which? [fake: ask="Which one?" options="a|b"]');
    await w.s.settle();
    expect((await reloadThread(w.s, thread.id)).status).toBe("waiting-on-you");

    await w.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect(await reloadThread(w.s, thread.id)).toMatchObject({
      status: "waiting-on-you",
      blockedQuestion: { question: "Which one?" },
    });

    await w.s.services.threads.reply(thread.id, "a");
    await w.s.settle();
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });

  test("one waiting out a usage limit is left waiting: a message would end the wait", async () => {
    const w = await world.setup();
    const { thread } = await failingWith(w);
    await w.s.services.threads.send(thread.id, "carry on [fake: ratelimit=3600]");
    await w.s.settle();
    const limited = await reloadThread(w.s, thread.id);
    expect(limited.status).toBe("rate-limited");

    await w.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect(await reloadThread(w.s, thread.id)).toMatchObject({
      status: "rate-limited",
      resumesAt: (limited as { resumesAt: string }).resumesAt,
    });
  });

  test("one the person resolved is still watched, but never reopened by a fix", async () => {
    const w = await world.setup();
    const { thread } = await failingWith(w);
    const resolved = await w.s.services.threads.resolve(thread.id);
    expect(resolved.success && resolved.thread.status).toBe("resolved");

    await w.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    const after = await reloadThread(w.s, thread.id);
    expect(after.status).toBe("resolved");
    expect(after.artifacts[0]).toMatchObject({ checks: { state: "failure" } });
  });

  test("a failure that does not stay failing is never asked about: the checks pass before the thread rests", async () => {
    const w = await world.setup();
    const { thread, number } = await failingWith(w);
    await w.s.services.threads.send(thread.id, "carry on [fake: startup=1200]");
    await w.watcher.tick();
    w.github.ci.setChecks(number, "pass");
    await w.s.settle();

    await w.tick(MINUTE);
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect(await ledgerOf(w, thread.id)).toEqual([]);
  });
});

describe("a thread that changes while the watcher is still reading", () => {
  const withRunGh = (w: WatchWorld, before: () => Promise<unknown>) =>
    createPullRequestWatcher(
      w.s.ctx,
      { threads: w.s.services.threads, git: w.s.services.git, chat: w.s.services.chat },
      {
        runGh: async (args, cwd, options) => {
          // The log of a failing run is the last thing read before the fix is sent.
          if (args[0] === "run") await before();
          return w.github.run(args, cwd, options);
        },
        now: () => new Date(w.clock.now),
        random: () => 0.5,
      },
    );

  test("one that is resolved in the meantime is not reopened by the fix", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail", ["test"], "FAIL notes.test.ts");
    const watcher = withRunGh(w, () => w.s.services.threads.resolve(thread.id));

    await watcher.tick();
    await w.s.settle();

    expect((await reloadThread(w.s, thread.id)).status).toBe("resolved");
    expect(await fixPrompts(w, thread.id)).toEqual([]);
    // The attempt was not spent: the fix is still owed, and is asked for once the thread can take it.
    expect(await ledgerOf(w, thread.id)).toEqual([]);
  });

  test("one that started a turn in the meantime keeps it: the fix waits for its next rest", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail", ["test"], "FAIL notes.test.ts");
    const watcher = withRunGh(w, () =>
      w.s.services.threads.send(thread.id, "carry on [fake: startup=1200]"),
    );

    await watcher.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect(await ledgerOf(w, thread.id)).toEqual([]);
    await w.s.settle();
  });
});

describe("what is not a failure to fix", () => {
  test("a gate waiting for a human approval is left to the human", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail", ["PR review approver"]);

    await w.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({
      checks: { state: "failure", failing: 1 },
    });
  });

  test("a project that has its own reason to wait: a failure with another check still running", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "pending", ["test"]);

    await w.tick();
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toEqual([]);
  });
});

describe("what the project chooses", () => {
  test("with auto-fix off the checks are still published and nothing is sent, until it is turned on", async () => {
    const w = await world.setup({ settings: { autoFixPullRequests: false } });
    const { thread } = await failingWith(w);

    await w.tick();

    expect(await fixPrompts(w, thread.id)).toEqual([]);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({
      checks: { state: "failure" },
    });
    expect(await w.watcher.summary(thread.id)).toMatchObject({
      success: true,
      watch: { enabled: false, attempts: 0 },
    });

    await w.s.services.projects.update(w.project.id, { autoFixPullRequests: true });
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });

  test("a paused project is not watched at all", async () => {
    const w = await world.setup();
    const { thread } = await failingWith(w);
    await w.s.services.projects.transition(w.project.id, "pause");

    await w.tick();

    expect(w.github.callsTo("pr view")).toHaveLength(0);
    expect(await fixPrompts(w, thread.id)).toEqual([]);
  });

  test("the notification level is the client's to apply: with it off the watcher still stops at the cap, reports and marks the thread", async () => {
    const w = await world.setup({
      settings: { notificationLevel: "off" },
      watch: { maxAttempts: 1 },
    });
    const { thread, number } = await failingWith(w);
    await w.tick();
    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
    await w.s.services.threads.markRead(thread.id);
    const before = await reloadThread(w.s, thread.id);

    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail");
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
    expect((await reportsToCoordinator(w, w.project.id)).at(-1)).toStartWith("needs-you: ");
    const stopped = await reloadThread(w.s, thread.id);
    expect(stopped).toMatchObject({
      unread: true,
      liveStatusLine: "Auto-fix stopped after 1 attempt: failing checks: test",
    });
    // It moved: a client that reads "news" from how recently a thread moved sees it.
    expect(stopped.lastActivityAt > before.lastActivityAt).toBe(true);
    expect((await ledgerOf(w, thread.id)).map((entry) => entry.kind)).toEqual(["fix", "cap"]);
  });

  test("the summary says what was sent, and that the watcher gave up", async () => {
    const w = await world.setup({ watch: { maxAttempts: 1 } });
    const { thread, number } = await failingWith(w);
    await w.tick();
    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail");
    await w.tick(MINUTE);

    const summary = await w.watcher.summary(thread.id);

    expect(summary).toMatchObject({
      success: true,
      watch: {
        enabled: true,
        maxAttempts: 1,
        attempts: 1,
        gaveUp: true,
        actions: [
          { kind: "fix", summary: "failing checks: test" },
          { kind: "cap", summary: "failing checks: test" },
        ],
      },
    });
    expect(await w.watcher.summary("nobody")).toEqual({
      success: false,
      error: { code: "THREAD_NOT_FOUND" },
    });
  });
});
