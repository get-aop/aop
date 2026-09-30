import { describe, expect, test } from "bun:test";
import {
  fixPrompts,
  ledgerOf,
  MINUTE,
  openedThread,
  useWatchWorld,
  type WatchWorld,
} from "./test-utils.ts";
import { createPullRequestWatcher } from "./watcher.ts";

const world = useWatchWorld();

/** A watcher whose server dies while sending the fix: before the thread has the message, or after. */
const dyingWatcher = (w: WatchWorld, dies: "before" | "after") =>
  createPullRequestWatcher(
    w.s.ctx,
    {
      threads: {
        send: async (threadId, text, origin) => {
          if (dies === "before") throw new Error("the server died");
          await w.s.services.threads.send(threadId, text, origin);
          throw new Error("the server died");
        },
      },
      git: w.s.services.git,
      chat: w.s.services.chat,
    },
    { runGh: w.github.run, now: () => new Date(w.clock.now), random: () => 0.5 },
  );

describe("a server that died in the middle of sending a fix", () => {
  test("after the thread had the message: the message stands, and it is not sent again", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");

    await dyingWatcher(w, "after").tick();
    await w.s.settle();
    // What the crash left: the fix written down, never confirmed, and the thread with its message.
    expect(await ledgerOf(w, thread.id)).toMatchObject([{ kind: "fix", delivered: false }]);
    expect(await fixPrompts(w, thread.id)).toHaveLength(1);

    // The restarted server settles it against the thread's messages.
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
    expect(await ledgerOf(w, thread.id)).toMatchObject([{ kind: "fix", delivered: true }]);
  });

  test("before the thread had it: the attempt did not happen, and the fix is sent once", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");

    await dyingWatcher(w, "before").tick();
    const died = await ledgerOf(w, thread.id);
    expect(died).toMatchObject([{ kind: "fix", delivered: false }]);
    expect(await fixPrompts(w, thread.id)).toEqual([]);

    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
    const settled = await ledgerOf(w, thread.id);
    expect(settled).toMatchObject([{ kind: "fix", delivered: true }]);
    // The attempt that never happened was not counted against the cap.
    expect(settled[0]?.id).not.toBe(died[0]?.id);
    expect(settled).toHaveLength(1);
  });

  test("a send the thread refused releases the attempt, so a later poll sends it", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");
    const refusing = createPullRequestWatcher(
      w.s.ctx,
      {
        threads: {
          send: async () => ({
            success: false,
            error: { code: "SEND_FAILED", reason: "SESSION_NOT_FOUND" },
          }),
        },
        git: w.s.services.git,
        chat: w.s.services.chat,
      },
      { runGh: w.github.run, now: () => new Date(w.clock.now), random: () => 0.5 },
    );

    await refusing.tick();
    expect(await ledgerOf(w, thread.id)).toEqual([]);

    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });
});
