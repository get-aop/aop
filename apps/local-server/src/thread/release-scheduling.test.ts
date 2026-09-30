import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Thread } from "@aop/common";
import { useTempAopHome } from "../project/test-utils.ts";
import { setRunCap, untilStatus } from "../scheduling/test-utils.ts";
import { git } from "./git-test-utils.ts";
import { type PrWorld, reloadThread, setupPrWorld, worktreeOf } from "./pr-test-utils.ts";

/*
 * A thread's worktree stays while its turn is only waiting: for a free run slot under the host's
 * cap, or for a usage limit to reset. Both leave the thread with no process running, and both end
 * in a turn that runs in the worktree.
 */

setDefaultTimeout(30_000);

const home = useTempAopHome();
let world: PrWorld | undefined;

afterEach(async () => {
  await world?.s.cleanup();
  world = undefined;
});

const setup = async () => {
  world = await setupPrWorld(home.path());
  return world;
};

const spawn = async (w: PrWorld, title: string, marker: string) => {
  const spawned = await w.s.services.threads.spawn(w.project.id, {
    title,
    prompt: `Do it ${marker}`,
  });
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  return spawned.thread;
};

const cwdsOf = (w: PrWorld, threadId: string) =>
  w.s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === threadId).map((run) => run.cwd);

describe("threads waiting for a run slot", () => {
  test("each keeps a worktree of its own while it waits, and runs in it when its turn comes, in the order they came", async () => {
    const w = await setup();
    await setRunCap(w.s, 1);

    const first = await spawn(w, "First", '[fake: write="first.md=one" startup=1500]');
    const second = await spawn(w, "Second", '[fake: write="second.md=two" startup=100]');
    const third = await spawn(w, "Third", '[fake: write="third.md=three" startup=100]');
    const threads = [first, second, third];

    expect((await reloadThread(w.s, second.id)).status).toBe("queued");
    for (const thread of threads) expect(existsSync(worktreeOf(w, thread))).toBe(true);
    expect(new Set(threads.map((thread) => worktreeOf(w, thread))).size).toBe(3);
    // A queued turn is going to run in the worktree, so the worktree is not released under it.
    const refused = await w.s.services.threads.resolve(second.id);
    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(existsSync(worktreeOf(w, second))).toBe(true);

    await untilStatus(w.s, third.id, "idle");
    await w.s.settle();

    const order = w.s.runs
      .map((run) => run.env?.AOP_CHAT_SESSION_ID ?? "")
      .filter((id) => threads.some((thread) => thread.id === id));
    expect(order).toEqual(threads.map((thread) => thread.id));
    for (const [thread, file] of [
      [first, "first.md"],
      [second, "second.md"],
      [third, "third.md"],
    ] as const) {
      expect(cwdsOf(w, thread.id)).toEqual([realPath(w, thread)]);
      expect(existsSync(join(worktreeOf(w, thread), file))).toBe(true);
    }
    // Each file is in its own worktree only.
    expect(existsSync(join(worktreeOf(w, first), "second.md"))).toBe(false);
    expect(existsSync(join(w.repo.path, "first.md"))).toBe(false);
  });
});

describe("a thread waiting out a usage limit", () => {
  test("keeps its worktree and the file its turn wrote, and the resumed turn runs in it", async () => {
    const w = await setup();

    const thread = await spawn(w, "Limited", '[fake: write="limited.md=kept" ratelimit=2]');
    const held = await untilStatus(w.s, thread.id, "rate-limited");

    expect(held.status).toBe("rate-limited");
    const refused = await w.s.services.threads.resolve(thread.id);
    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(readFileSync(join(worktreeOf(w, thread), "limited.md"), "utf8")).toBe("kept");

    await untilStatus(w.s, thread.id, "idle");
    await w.s.settle();

    expect(cwdsOf(w, thread.id)).toEqual([realPath(w, thread), realPath(w, thread)]);
    expect(readFileSync(join(worktreeOf(w, thread), "limited.md"), "utf8")).toBe("kept");
  });

  test("Stop ends the wait, and then the worktree can be released with its work kept", async () => {
    const w = await setup();
    const thread = await spawn(w, "Stopped", '[fake: write="stopped.md=kept" ratelimit=3600]');
    await untilStatus(w.s, thread.id, "rate-limited");

    await w.s.services.threads.stop(thread.id);
    const resolved = await w.s.services.threads.resolve(thread.id);

    expect(resolved).toMatchObject({ success: true, thread: { status: "resolved" } });
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
    expect(git(w.repo.path, "show", `${thread.branch}:stopped.md`)).toBe("kept");
  });

  test("resuming by hand runs the turn in the worktree the wait kept", async () => {
    const w = await setup();
    const thread = await spawn(w, "Resumed", '[fake: write="resumed.md=kept" ratelimit=3600]');
    await untilStatus(w.s, thread.id, "rate-limited");

    const resumed = await w.s.services.threads.resume(thread.id);
    await untilStatus(w.s, thread.id, "idle");
    await w.s.settle();

    expect(resumed.success).toBe(true);
    expect(cwdsOf(w, thread.id).at(-1)).toBe(realPath(w, thread));
    expect(existsSync(join(worktreeOf(w, thread), "resumed.md"))).toBe(true);
  });
});

// The path the engine runs in: the worktree with symlinks resolved (a temporary directory on macOS is one).
const realPath = (w: PrWorld, thread: Thread): string => realpathSync(worktreeOf(w, thread));
