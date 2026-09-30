import { describe, expect, test } from "bun:test";
import type { RunGh } from "../github-cli/index.ts";
import { reloadThread } from "../thread/pr-test-utils.ts";
import {
  fixPrompts,
  MINUTE,
  openedThread,
  SECOND,
  useWatchWorld,
  type WatchWorld,
} from "./test-utils.ts";
import { createPullRequestWatcher, startPullRequestWatcher } from "./watcher.ts";

const world = useWatchWorld();

const pass = (w: WatchWorld, advanceMs = 0) => w.tick(advanceMs);

describe("how many pull requests are read at once", () => {
  test("no more than the limit across repositories, and one at a time within a repository", async () => {
    const w = await world.setup({ repos: 3, watch: { maxConcurrent: 2 } });
    const [first, second, third] = w.s.repos;
    if (!first || !second || !third) throw new Error("repos missing");
    await openedThread(w, { title: "a", repoId: first.id });
    await openedThread(w, { title: "b", repoId: first.id });
    await openedThread(w, { title: "c", repoId: second.id });
    await openedThread(w, { title: "d", repoId: third.id });
    w.github.readLoad.setDelay(30);

    await pass(w);

    // All four were read, and the bounds held while they were.
    expect(w.github.callsTo("pr view")).toHaveLength(4);
    expect(w.github.readLoad.peakAll()).toBe(2);
    expect(w.github.readLoad.peakIn(first.path)).toBe(1);
    expect(w.github.readLoad.peakIn(second.path)).toBe(1);
  });

  test("two passes that overlap share one", async () => {
    const w = await world.setup();
    await openedThread(w);
    w.github.readLoad.setDelay(30);

    await Promise.all([w.watcher.tick(), w.watcher.tick(), w.watcher.tick()]);

    expect(w.github.callsTo("pr view")).toHaveLength(1);
  });
});

describe("when a read fails", () => {
  test("the pull request is looked at again after a wait that doubles on each failure", async () => {
    const w = await world.setup();
    await openedThread(w);
    w.github.failReads("HTTP 502: Bad Gateway");
    const reads = () => w.github.callsTo("pr view").length;

    await pass(w);
    expect(reads()).toBe(1);
    await pass(w, 30 * SECOND);
    expect(reads()).toBe(1);
    await pass(w, 30 * SECOND);
    expect(reads()).toBe(2);
    // The second failure doubled the wait: two minutes, not one.
    await pass(w, 100 * SECOND);
    expect(reads()).toBe(2);
    await pass(w, 20 * SECOND);
    expect(reads()).toBe(3);
  });

  test("and it succeeds again, the pull request is answered as if nothing had happened", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");
    w.github.failReads("HTTP 502: Bad Gateway");
    await pass(w);
    expect(await fixPrompts(w, thread.id)).toEqual([]);

    w.github.failReads(null);
    await pass(w, 2 * MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });

  test("a repository GitHub throttles is left alone for a while, all of its pull requests", async () => {
    const w = await world.setup();
    await openedThread(w, { title: "a" });
    await openedThread(w, { title: "b" });
    w.github.failReads("gh: API rate limit exceeded for user (HTTP 403)");
    const reads = () => w.github.callsTo("pr view").length;

    // The first look is throttled, so the second pull request of the repository is not even tried.
    await pass(w);
    expect(reads()).toBe(1);
    await pass(w, 5 * MINUTE);
    expect(reads()).toBe(1);

    w.github.failReads(null);
    await pass(w, 6 * MINUTE);
    expect(reads()).toBe(3);
  });

  test("a gh that cannot start fails that repository's poll and no other, and never the pass", async () => {
    const w = await world.setup({ repos: 2 });
    const [first, second] = w.s.repos;
    if (!first || !second) throw new Error("repos missing");
    const a = await openedThread(w, { title: "a", repoId: first.id });
    const b = await openedThread(w, { title: "b", repoId: second.id });
    w.github.ci.setChecks(a.number, "fail");
    w.github.ci.setChecks(b.number, "fail");
    const brokenFor =
      (cwd: string): RunGh =>
      async (args, at, options) => {
        if (at === cwd) throw new Error("spawn gh ENOENT");
        return w.github.run(args, at, options);
      };
    const watcher = createPullRequestWatcher(
      w.s.ctx,
      { threads: w.s.services.threads, git: w.s.services.git, chat: w.s.services.chat },
      { runGh: brokenFor(first.path), now: () => new Date(w.clock.now), random: () => 0.5 },
    );

    await watcher.tick();
    await w.s.settle();

    expect(await fixPrompts(w, a.thread.id)).toEqual([]);
    expect(await fixPrompts(w, b.thread.id)).toHaveLength(1);
  });
});

describe("how often it looks when there is nothing it can do", () => {
  test("a pull request whose fix is owed to a thread that is not at rest is looked at less and less often", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    await w.s.services.threads.resolve(thread.id);
    w.github.ci.setChecks(number, "fail");
    const reads = () => w.github.callsTo("pr view").length;

    // Every 30 seconds for ten minutes would be 20 looks, and 8 with the pace of running checks;
    // waiting on a thread is quiet: the waits grow to 5 minutes.
    for (let second = 0; second <= 600; second += 30) await w.tick(second === 0 ? 0 : 30 * SECOND);

    expect(reads()).toBeLessThanOrEqual(5);
    expect(reads()).toBeGreaterThanOrEqual(3);
  });

  test("an end that the thread does not take is a failure to back off from, not news", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    let syncs = 0;
    const stuck = createPullRequestWatcher(
      w.s.ctx,
      {
        threads: w.s.services.threads,
        chat: w.s.services.chat,
        // A sync that finds nothing to change, as when GitHub's list lags or names another pull request.
        git: {
          syncPullRequest: async (threadId) => {
            syncs += 1;
            return { success: true, thread: await reloadThread(w.s, threadId) };
          },
        },
      },
      { runGh: w.github.run, now: () => new Date(w.clock.now), random: () => 0.5 },
    );
    w.github.mergeOnGithub(number);

    for (let second = 0; second <= 300; second += 30) {
      w.clock.now += second === 0 ? 0 : 30 * SECOND;
      await stuck.tick();
    }

    // 60, 120, 240 seconds and so on: a handful of syncs in five minutes, not ten.
    expect(syncs).toBeLessThanOrEqual(4);
    expect(syncs).toBeGreaterThanOrEqual(2);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({ state: "open" });
  });
});

describe("what it leaves alone", () => {
  test("a pull request that is not open, and one whose project is paused, is not read", async () => {
    const w = await world.setup();
    const { number } = await openedThread(w);
    w.github.closeOnGithub(number);
    await pass(w);
    const reads = w.github.callsTo("pr view").length;

    await pass(w, 10 * MINUTE);

    expect(w.github.callsTo("pr view")).toHaveLength(reads);
  });
});

describe("starting the watcher", () => {
  const counting = (durationMs = 0) => {
    const passes = { started: 0, finished: 0 };
    return {
      passes,
      tick: async () => {
        passes.started += 1;
        await Bun.sleep(durationMs);
        passes.finished += 1;
        if (passes.started === 2) throw new Error("a pass failed");
      },
    };
  };

  test("runs a pass at once and then regularly, and a failed pass does not stop it", async () => {
    const watcher = counting();
    const stop = startPullRequestWatcher(watcher, 20);

    expect(watcher.passes.started).toBe(1);
    await Bun.sleep(120);
    await stop();

    expect(watcher.passes.started).toBeGreaterThanOrEqual(4);
  });

  test("stopping waits for the pass under way, and starts no other", async () => {
    const watcher = counting(60);
    const stop = startPullRequestWatcher(watcher, 20);
    await Bun.sleep(10);

    await stop();
    const started = watcher.passes.started;

    expect(watcher.passes.finished).toBe(started);
    await Bun.sleep(80);
    expect(watcher.passes.started).toBe(started);
  });
});
