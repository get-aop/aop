import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("migration v22", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
    await db
      .insertInto("routines")
      .values({
        id: "r1",
        project_id: "p1",
        name: "Digest",
        prompt: "Summarize",
        schedule_json: '{"kind":"daily","time":"09:00"}',
        target: "thread",
        repo_id: null,
        model: null,
        effort: null,
        created_by: "person",
        next_run_at: "2026-06-01T09:00:00.000Z",
      })
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const run = (key: string, values: Partial<{ state: string; thread_id: string }> = {}) =>
    db
      .insertInto("routine_runs")
      .values({
        id: `run-${key}-${crypto.randomUUID()}`,
        routine_id: "r1",
        occurrence_key: key,
        occurrence: "2026-06-01T09:00:00.000Z",
        trigger: "schedule",
        state: (values.state ?? "started") as never,
        reason: null,
        thread_id: values.thread_id ?? null,
        message_id: null,
      })
      .execute();

  test("an occurrence has one run per routine", async () => {
    await run("2026-06-01T09:00:00.000Z");
    await expect(run("2026-06-01T09:00:00.000Z")).rejects.toThrow(/UNIQUE constraint failed/);
    await run("manual:1");
  });

  test("a run's state and a routine's schedule are checked", async () => {
    await expect(run("k", { state: "done" })).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.updateTable("routines").set({ schedule_json: "[]" }).where("id", "=", "r1").execute(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  test("a deleted thread leaves its run in the history; a deleted project takes its routines", async () => {
    await run("k", { thread_id: "t1" });
    await db.deleteFrom("chat_sessions").where("id", "=", "t1").execute();
    expect(
      await db.selectFrom("routine_runs").select(["occurrence_key", "thread_id"]).execute(),
    ).toEqual([{ occurrence_key: "k", thread_id: null }]);

    await db.deleteFrom("projects").where("id", "=", "p1").execute();
    expect(await db.selectFrom("routines").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("routine_runs").selectAll().execute()).toEqual([]);
  });
});
