import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const columnInfo = async (db: Kysely<Database>, column: string) => {
  const { rows } = await sql<{ name: string; notnull: number }>`
    SELECT name, "notnull" FROM pragma_table_info('chat_sessions') WHERE name = ${column}
  `.execute(db);
  return rows;
};

const runtimeOf = async (db: Kysely<Database>, id: string) =>
  db
    .selectFrom("chat_sessions")
    .select(["model", "reasoning_effort"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("migration v9 on a database that ran versions 1 to 8", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(8));
  });

  afterEach(async () => {
    await db.destroy();
  });

  const seedSessions = async () => {
    // "on-default" has both roles on default; "explicit" names a model and effort for each.
    await insertProjectRow(db, "on-default");
    await insertProjectRow(db, "explicit");
    await db
      .updateTable("projects")
      .set({
        coordinator_model: "claude-opus-4-8",
        coordinator_effort: "low",
        thread_model: "claude-sonnet-4-6",
        thread_effort: "high",
      })
      .where("id", "=", "explicit")
      .execute();
    for (const project of ["on-default", "explicit"]) {
      await insertProjectSession(db, {
        id: `${project}-coordinator`,
        projectId: project,
        kind: "coordinator",
      });
      await insertProjectSession(db, {
        id: `${project}-thread`,
        projectId: project,
        kind: "thread",
      });
    }
    await insertProjectSession(
      db,
      { id: "plain", projectId: "explicit", kind: "thread" },
      { project_id: null, kind: null, state: null, last_activity_at: null },
    );
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content)
      VALUES ('m1', 'on-default-thread', 'user', 'hello')
    `.execute(db);
  };

  test("makes the model and effort nullable and keeps every session and its messages", async () => {
    await seedSessions();
    expect((await columnInfo(db, "model"))[0]?.notnull).toBe(1);

    await runMigrations(db);

    expect(await columnInfo(db, "model")).toEqual([{ name: "model", notnull: 0 }]);
    expect(await columnInfo(db, "reasoning_effort")).toEqual([
      { name: "reasoning_effort", notnull: 0 },
    ]);
    expect(await db.selectFrom("chat_sessions").select("id").execute()).toHaveLength(5);
    expect(await db.selectFrom("chat_messages").select("id").execute()).toEqual([{ id: "m1" }]);
    expect((await sql`PRAGMA foreign_key_check`.execute(db)).rows).toEqual([]);
  });

  test("clears what a role on default was given, and keeps what a project chose", async () => {
    await seedSessions();

    await runMigrations(db);

    const none = { model: null, reasoning_effort: null };
    expect(await runtimeOf(db, "on-default-coordinator")).toEqual(none);
    expect(await runtimeOf(db, "on-default-thread")).toEqual(none);
    expect(await runtimeOf(db, "explicit-coordinator")).toEqual({
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
    });
    expect(await runtimeOf(db, "explicit-thread")).toEqual({
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
    });
  });

  test("clears the model and the effort of a role on their own", async () => {
    await insertProjectRow(db, "half");
    await db
      .updateTable("projects")
      .set({ coordinator_model: "claude-opus-4-8", coordinator_effort: null })
      .where("id", "=", "half")
      .execute();
    await insertProjectSession(db, {
      id: "half-coordinator",
      projectId: "half",
      kind: "coordinator",
    });

    await runMigrations(db);

    expect(await runtimeOf(db, "half-coordinator")).toEqual({
      model: "claude-opus-4-8",
      reasoning_effort: null,
    });
  });

  test("leaves a session outside any project as it was", async () => {
    await seedSessions();

    await runMigrations(db);

    expect(await runtimeOf(db, "plain")).toEqual({
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
    });
  });

  test("a fresh database takes a session with no model or effort", async () => {
    const fresh = createDatabase(":memory:");
    await runMigrations(fresh);
    await insertProjectRow(fresh, "p1");

    await insertProjectSession(
      fresh,
      { id: "t1", projectId: "p1", kind: "thread" },
      { model: null, reasoning_effort: null },
    );

    expect(await runtimeOf(fresh, "t1")).toEqual({ model: null, reasoning_effort: null });
    await fresh.destroy();
  });
});
