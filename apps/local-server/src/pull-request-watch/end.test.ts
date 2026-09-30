import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { git, gitSucceeds } from "../thread/git-test-utils.ts";
import { reloadThread, statusesInLog, worktreeOf } from "../thread/pr-test-utils.ts";
import {
  MINUTE,
  openedThread,
  reportsToCoordinator,
  useWatchWorld,
  type WatchWorld,
} from "./test-utils.ts";
import { createPullRequestWatcher } from "./watcher.ts";

const world = useWatchWorld();

const told = async (w: WatchWorld, text: string): Promise<string[]> =>
  (await reportsToCoordinator(w, w.project.id)).filter((report) => report.includes(text));

describe("a pull request merged on GitHub", () => {
  test("lands the thread through the merge route's own logic, and tells the coordinator once", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "pass");
    await w.tick();
    w.github.mergeOnGithub(number);

    await w.tick(MINUTE);

    const landed = await reloadThread(w.s, thread.id);
    expect(landed.status).toBe("resolved");
    expect(landed.artifacts).toEqual([
      {
        type: "pr",
        number,
        url: "https://github.com/acme/widget/pull/1",
        state: "merged",
        checks: { state: "success", successful: 1, failing: 0, pending: 0 },
      },
    ]);
    // Cleanup is the landing's: the worktree, the local branch and the branch on origin are gone.
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
    expect(gitSucceeds(w.repo.path, "rev-parse", "--verify", `refs/heads/${thread.branch}`)).toBe(
      false,
    );
    expect(git(w.repo.origin, "branch", "--list", thread.branch as string)).toBe("");
    expect((await statusesInLog(w.s, thread.id)).at(-1)).toBe("resolved");
    expect(await told(w, "was merged on GitHub")).toEqual([
      `finished: Thread report: "Fix the cold start" (${thread.id}): its pull request #1 was merged on GitHub.`,
    ]);

    // It is not open any more, so nobody looks at it again and nothing is repeated.
    const reads = w.github.callsTo("pr view").length;
    await w.tick(10 * MINUTE);
    expect(w.github.callsTo("pr view")).toHaveLength(reads);
    expect(await told(w, "was merged on GitHub")).toHaveLength(1);
  });

  test("a thread that was working carries on, with the merge recorded and the checkout left to it", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    await w.s.services.threads.send(thread.id, "carry on [fake: startup=1200]");
    w.github.mergeOnGithub(number);

    await w.watcher.tick();

    const after = await reloadThread(w.s, thread.id);
    expect(after.artifacts[0]).toMatchObject({ state: "merged" });
    expect(after.status).not.toBe("resolved");
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
    await w.s.settle();
  });

  test("the report is written down before the thread is brought in line, so a failure in between repeats nothing", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    let refusals = 1;
    const flaky = createPullRequestWatcher(
      w.s.ctx,
      {
        threads: w.s.services.threads,
        chat: w.s.services.chat,
        git: {
          syncPullRequest: async (threadId) =>
            refusals-- > 0
              ? {
                  success: false,
                  error: { code: "PULL_REQUEST_FAILED", reason: "GH_UNAVAILABLE", message: "down" },
                }
              : w.s.services.git.syncPullRequest(threadId),
        },
      },
      { runGh: w.github.run, now: () => new Date(w.clock.now), random: () => 0.5 },
    );
    w.github.mergeOnGithub(number);

    await flaky.tick();
    expect((await reloadThread(w.s, thread.id)).status).not.toBe("resolved");
    expect(await told(w, "was merged on GitHub")).toHaveLength(1);

    w.clock.now += 2 * MINUTE;
    await flaky.tick();

    expect((await reloadThread(w.s, thread.id)).status).toBe("resolved");
    expect(await told(w, "was merged on GitHub")).toHaveLength(1);
  });

  test("one that was merged through AOP is not the watcher's to report", async () => {
    const w = await world.setup();
    const { thread } = await openedThread(w);

    const merged = await w.s.services.threads.mergePullRequest(thread.id, {});
    const readsByTheMerge = w.github.callsTo("pr view").length;
    await w.tick();

    expect(merged.success && merged.thread.status).toBe("resolved");
    expect(w.github.callsTo("pr view")).toHaveLength(readsByTheMerge);
    expect(await told(w, "was merged on GitHub")).toEqual([]);
  });

  test("one merged while the person's own merge is landing is left to that merge", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.mergeOnGithub(number);
    // The merge route has put the thread in landing and is still cleaning up.
    await w.s.db
      .updateTable("chat_sessions")
      .set({ state: "landing" })
      .where("id", "=", thread.id)
      .execute();

    await w.tick();

    expect(w.github.callsTo("pr view")).toHaveLength(0);
    expect(await told(w, "was merged on GitHub")).toEqual([]);
  });
});

describe("the line the watcher left when it gave up", () => {
  const gaveUp = async (w: WatchWorld) => {
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");
    await w.tick();
    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail");
    await w.tick(MINUTE);
    expect((await reloadThread(w.s, thread.id)).liveStatusLine).toStartWith(
      "Auto-fix stopped after",
    );
    return { thread, number };
  };

  test("is replaced when the pull request merges", async () => {
    const w = await world.setup({ watch: { maxAttempts: 1 } });
    const { thread, number } = await gaveUp(w);
    w.github.mergeOnGithub(number);

    await w.tick(MINUTE);

    expect(await reloadThread(w.s, thread.id)).toMatchObject({
      status: "resolved",
      liveStatusLine: "Pull request #1 was merged",
    });
  });

  test("is replaced when it closes", async () => {
    const w = await world.setup({ watch: { maxAttempts: 1 } });
    const { thread, number } = await gaveUp(w);
    w.github.closeOnGithub(number);

    await w.tick(MINUTE);

    expect((await reloadThread(w.s, thread.id)).liveStatusLine).toBe(
      "Pull request #1 was closed without merging",
    );
  });
});

describe("a merge the watcher finds", () => {
  test("leaves the thread's own line alone", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    const own = (await reloadThread(w.s, thread.id)).liveStatusLine;
    w.github.mergeOnGithub(number);

    await w.tick();

    expect((await reloadThread(w.s, thread.id)).liveStatusLine).toBe(own);
  });
});

describe("a pull request closed without merging", () => {
  test("is recorded as closed, keeps the thread and its work, and asks the coordinator what to do", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.closeOnGithub(number);

    await w.tick();

    const after = await reloadThread(w.s, thread.id);
    expect(after.status).toBe("ready-for-review");
    expect(after.artifacts[0]).toMatchObject({ state: "closed" });
    // A pull request that closed is news, and a client reads that from how recently the thread moved.
    expect(after.lastActivityAt > thread.lastActivityAt).toBe(true);
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
    expect(await told(w, "closed without being merged")).toEqual([
      expect.stringMatching(
        /^needs-you: .*\(isess_.*\): its pull request #1 was closed without being merged/,
      ),
    ]);

    await w.tick(10 * MINUTE);
    expect(await told(w, "closed without being merged")).toHaveLength(1);
  });
});

describe("the notification level", () => {
  test("is not the server's to apply: a merge is landed and reported whatever the level", async () => {
    const w = await world.setup({ settings: { notificationLevel: "off" } });
    const { thread, number } = await openedThread(w);
    w.github.mergeOnGithub(number);

    await w.tick();

    expect((await reloadThread(w.s, thread.id)).status).toBe("resolved");
    expect(await told(w, "was merged on GitHub")).toHaveLength(1);
  });
});
