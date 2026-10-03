import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createSettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import { countRunningThreadRuns, listRunningTurns, readRunCap } from "./capacity.ts";
import { hasQueuedMessage, listQueuedThreadTurns } from "./queue.ts";
import { insertQueuedMessage, insertRun } from "./test-utils.ts";

const T = (minute: number) => `2026-09-30T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("the run queue", () => {
  let db: Kysely<Database>;

  const thread = (id: string, columns: Parameters<typeof insertProjectSession>[2] = {}) =>
    insertProjectSession(db, { id, projectId: "p1", kind: "thread" }, columns);
  const queued = async () => (await listQueuedThreadTurns(db)).map((turn) => turn.sessionId);

  beforeEach(async () => {
    db = await createTestDb();
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("lists thread sessions by when their oldest waiting message was stored", async () => {
    await thread("late");
    await thread("early");
    await thread("middle");
    await insertQueuedMessage(db, "late", T(30));
    await insertQueuedMessage(db, "early", T(10));
    await insertQueuedMessage(db, "middle", T(20));
    // A newer message behind the oldest does not move a session back in line.
    await insertQueuedMessage(db, "early", T(40), "early-2");

    expect(await queued()).toEqual(["early", "middle", "late"]);
  });

  test("messages stored in the same millisecond keep the order they were stored in", async () => {
    for (const id of ["c", "a", "b"]) {
      await thread(id);
      await insertQueuedMessage(db, id, T(5));
    }

    expect(await queued()).toEqual(["c", "a", "b"]);
  });

  test("a session with a run going waits for it: its steer is not ready yet", async () => {
    await thread("busy");
    await thread("idle");
    const first = await insertQueuedMessage(db, "busy", T(1), "busy-1");
    await insertRun(db, "busy", first, "running");
    await insertQueuedMessage(db, "busy", T(2), "busy-2");
    await insertQueuedMessage(db, "idle", T(3));

    expect(await queued()).toEqual(["idle"]);
  });

  test("a message that already has a run is not waiting", async () => {
    await thread("done");
    const message = await insertQueuedMessage(db, "done", T(1));
    await insertRun(db, "done", message, "completed");

    expect(await queued()).toEqual([]);
    expect(await hasQueuedMessage(db, "done")).toBe(false);
  });

  test("a thread waiting out a rate limit is not ready until it resumes", async () => {
    await thread("limited", { state: "rate-limited", resumes_at: T(59) });
    await insertQueuedMessage(db, "limited", T(1));

    expect(await queued()).toEqual([]);
    expect(await hasQueuedMessage(db, "limited")).toBe(true);
  });

  test("a paused or archived project's threads wait for it to be active again", async () => {
    await thread("t1");
    await insertQueuedMessage(db, "t1", T(1));

    await db.updateTable("projects").set({ status: "paused" }).execute();
    expect(await queued()).toEqual([]);
    await db.updateTable("projects").set({ status: "active" }).execute();
    expect(await queued()).toEqual(["t1"]);
  });

  test("coordinators and plain sessions are never queued", async () => {
    await insertProjectSession(db, { id: "coordinator", projectId: "p1", kind: "coordinator" });
    await insertQueuedMessage(db, "coordinator", T(1));

    expect(await queued()).toEqual([]);
  });

  test("reports each thread's status so only those not yet shown as queued are updated", async () => {
    await thread("shown", { state: "queued" });
    await thread("not-yet");
    await insertQueuedMessage(db, "shown", T(1));
    await insertQueuedMessage(db, "not-yet", T(2));

    const turns = await listQueuedThreadTurns(db);

    expect(turns.map(({ sessionId, state }) => [sessionId, state])).toEqual([
      ["shown", "queued"],
      ["not-yet", "working"],
    ]);
  });
});

describe("the run cap", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("counts running thread runs only: coordinator runs never use a slot", async () => {
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
    await insertProjectSession(db, { id: "t2", projectId: "p1", kind: "thread" });
    await insertProjectSession(db, { id: "c1", projectId: "p1", kind: "coordinator" });
    await insertRun(db, "t1", await insertQueuedMessage(db, "t1", T(1)), "running");
    await insertRun(db, "t2", await insertQueuedMessage(db, "t2", T(2)), "completed");
    await insertRun(db, "c1", await insertQueuedMessage(db, "c1", T(3)), "running");

    expect(await countRunningThreadRuns(db)).toBe(1);
  });

  test("is the saved setting, four by default, and the default again for a value nobody could have saved", async () => {
    const settings = createSettingsRepository(db);
    expect(await readRunCap(settings)).toBe(4);

    await settings.set(SettingKey.MAX_CONCURRENT_RUNS, "2");
    expect(await readRunCap(settings)).toBe(2);

    await settings.set(SettingKey.MAX_CONCURRENT_RUNS, "0");
    expect(await readRunCap(settings)).toBe(4);
    await settings.set(SettingKey.MAX_CONCURRENT_RUNS, "lots");
    expect(await readRunCap(settings)).toBe(4);
  });

  test("names the running turns of every kind for a host update, and leaves finished ones out", async () => {
    await insertProjectSession(db, { id: "design", projectId: "p1", kind: "thread" });
    await insertProjectSession(db, { id: "coord", projectId: "p1", kind: "coordinator" });
    await insertRun(db, "design", await insertQueuedMessage(db, "design", T(1)), "running");
    await insertRun(db, "coord", await insertQueuedMessage(db, "coord", T(2)), "running");
    await insertProjectSession(db, { id: "done", projectId: "p1", kind: "thread" });
    await insertRun(db, "done", await insertQueuedMessage(db, "done", T(3)), "completed");

    const turns = await listRunningTurns(db);

    expect(
      turns
        .map(({ title, kind }) => ({ title, kind }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    ).toEqual([
      { title: "design", kind: "thread" },
      { title: "p1 coordinator", kind: "coordinator" },
    ]);
    expect(new Set(turns.map((turn) => turn.runId)).size).toBe(2);
  });
});
