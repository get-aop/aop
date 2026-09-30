import { describe, expect, test } from "bun:test";
import type { WatchSummary } from "./summary.ts";
import { openedThread, useWatchWorld } from "./test-utils.ts";

const world = useWatchWorld();

describe("GET /api/threads/:id/pull-request/watch", () => {
  test("says what the watcher sent, for the attempts and the cap a person is looking at", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    const path = `/api/threads/${thread.id}/pull-request/watch`;

    const before = await w.s.api<{ watch: WatchSummary }>("GET", path);
    expect(before).toMatchObject({
      status: 200,
      body: { watch: { enabled: true, maxAttempts: 3, attempts: 0, gaveUp: false, actions: [] } },
    });

    w.github.ci.setChecks(number, "fail", ["test", "lint"]);
    await w.tick();

    const after = await w.s.api<{ watch: WatchSummary }>("GET", path);
    expect(after.body.watch).toMatchObject({
      attempts: 1,
      gaveUp: false,
      actions: [{ kind: "fix", summary: "failing checks: test, lint" }],
    });
    expect(after.body.watch.actions[0]?.at).toBe(new Date(w.clock.now).toISOString());
  });

  test("answers 404 for a thread that does not exist and 409 for one that has no pull request", async () => {
    const w = await world.setup();
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Looking around",
      prompt: "look around",
    });
    if (!spawned.success) throw new Error("thread not spawned");

    const missing = await w.s.api("GET", "/api/threads/nope/pull-request/watch");
    const none = await w.s.api("GET", `/api/threads/${spawned.thread.id}/pull-request/watch`);

    expect(missing).toMatchObject({ status: 404, body: { code: "THREAD_NOT_FOUND" } });
    expect(none).toMatchObject({ status: 409, body: { code: "NO_PULL_REQUEST" } });
    await w.s.settle();
  });
});
