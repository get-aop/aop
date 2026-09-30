import { describe, expect, test } from "bun:test";
import { reloadThread } from "../thread/pr-test-utils.ts";
import { publishChecks } from "./publish.ts";
import {
  checksEntries,
  MINUTE,
  openedThread,
  SECOND,
  useWatchWorld,
  type WatchWorld,
} from "./test-utils.ts";

const world = useWatchWorld();

const upserts = async (w: WatchWorld): Promise<number> =>
  (
    await w.s.db
      .selectFrom("event_log")
      .select("id")
      .where("type", "=", "thread.upserted")
      .execute()
  ).length;

describe("publishing what the checks add up to", () => {
  test("puts the summary on the thread's pr artifact and on the project stream, once per change", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);

    // A repository with no checks has nothing to show.
    await w.tick();
    expect((await reloadThread(w.s, thread.id)).artifacts).toEqual([
      { type: "pr", number, url: "https://github.com/acme/widget/pull/1", state: "open" },
    ]);

    w.github.ci.setChecks(number, "pending", ["test", "lint"]);
    const before = await upserts(w);
    await w.tick(MINUTE);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({
      checks: { state: "pending", pending: 2, failing: 0, successful: 0 },
    });
    expect(await upserts(w)).toBe(before + 1);

    // Read again with nothing new, it says nothing.
    await w.tick(MINUTE);
    await w.tick(MINUTE);
    expect(await upserts(w)).toBe(before + 1);

    w.github.ci.setChecks(number, "pass", ["test", "lint"]);
    await w.tick(MINUTE);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({
      checks: { state: "success", pending: 0, failing: 0, successful: 2 },
    });
    expect(await checksEntries(w, thread.id)).toEqual([
      { state: "pending", pending: 2, failing: 0, successful: 0 },
      { state: "success", pending: 0, failing: 0, successful: 2 },
    ]);
    const stored = await w.s.db
      .selectFrom("chat_sessions")
      .select("pr_checks_json")
      .where("id", "=", thread.id)
      .executeTakeFirst();
    expect(JSON.parse(stored?.pr_checks_json ?? "null")).toEqual({
      state: "success",
      successful: 2,
      failing: 0,
      pending: 0,
    });
  });

  test("does not move the thread: its status, its unread mark and its place on the grid stay", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    const before = await reloadThread(w.s, thread.id);

    w.github.ci.setChecks(number, "pending");
    await w.tick();

    const after = await reloadThread(w.s, thread.id);
    expect(after).toMatchObject({
      status: before.status,
      unread: before.unread,
      lastActivityAt: before.lastActivityAt,
    });
  });

  test("a pull request that is no longer open, or is another one, is left as it is", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    const checks = { state: "failure", successful: 0, failing: 1, pending: 0 } as const;
    const entries = await upserts(w);

    expect(await publishChecks(w.s.ctx, thread.id, number + 1, checks)).toBe(false);
    expect(await publishChecks(w.s.ctx, "no-such-thread", number, checks)).toBe(false);
    w.github.mergeOnGithub(number);
    await w.s.services.threads.syncPullRequest(thread.id);
    const merged = await upserts(w);
    expect(await publishChecks(w.s.ctx, thread.id, number, checks)).toBe(false);

    expect(merged).toBeGreaterThan(entries);
    expect(await upserts(w)).toBe(merged);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({ state: "merged" });
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).not.toHaveProperty("checks");
  });

  test("clears the summary when GitHub stops reporting checks", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    const checks = { state: "pending", successful: 0, failing: 0, pending: 1 } as const;
    await publishChecks(w.s.ctx, thread.id, number, checks);

    expect(await publishChecks(w.s.ctx, thread.id, number, null)).toBe(true);

    expect((await reloadThread(w.s, thread.id)).artifacts[0]).not.toHaveProperty("checks");
  });
});

describe("when GitHub cannot be read", () => {
  test("nothing is published or sent, and what was published stays until a read succeeds", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "pass");
    await w.tick();
    const before = await upserts(w);

    w.github.ci.setChecks(number, "fail");
    w.github.failReads("HTTP 502: Bad Gateway");
    await w.tick(10 * MINUTE);

    expect(await upserts(w)).toBe(before);
    expect((await reloadThread(w.s, thread.id)).artifacts[0]).toMatchObject({
      checks: { state: "success" },
    });
    expect((await w.s.services.threads.get(thread.id)).success).toBe(true);
  });

  test("a pull request that is not due yet is not read", async () => {
    const w = await world.setup();
    const { number } = await openedThread(w);
    w.github.ci.setChecks(number, "pending");
    await w.tick();
    const reads = w.github.callsTo("pr view").length;

    await w.tick(10 * SECOND);
    await w.tick(10 * SECOND);
    expect(w.github.callsTo("pr view")).toHaveLength(reads);

    await w.tick(30 * SECOND);
    expect(w.github.callsTo("pr view")).toHaveLength(reads + 1);
  });
});
