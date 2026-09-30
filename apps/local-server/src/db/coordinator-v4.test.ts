import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import { seedChatSessionGraph } from "../chat-session/test-utils.ts";
import { insertProjectRow } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const tableNames = async (db: Kysely<Database>): Promise<string[]> => {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `.execute(db);
  return rows.map((row) => row.name);
};

describe("migration v4", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("a project starts with the safer thread access unless full access is chosen", async () => {
    await insertProjectRow(db, "p1");

    const row = await db
      .selectFrom("projects")
      .select("thread_access")
      .where("id", "=", "p1")
      .executeTakeFirstOrThrow();

    expect(row.thread_access).toBe("auto-accept-edits");
  });

  test("a run holds a JSON array of blocks, empty by default", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: "s1", withCheckpoints: false });
    const runId = seeded.runIds[0] as string;

    const fresh = await db
      .selectFrom("chat_runs")
      .select("blocks_json")
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    expect(fresh.blocks_json).toBe("[]");

    const notAnArray = db
      .updateTable("chat_runs")
      .set({ blocks_json: '{"type":"text"}' })
      .where("id", "=", runId)
      .execute();
    await expect(notAnArray).rejects.toThrow(/CHECK constraint failed/);
    const notJson = db
      .updateTable("chat_runs")
      .set({ blocks_json: "nope" })
      .where("id", "=", runId)
      .execute();
    await expect(notJson).rejects.toThrow(/CHECK constraint failed/);
  });

  test("a message has no origin unless one is written, and an origin is an object with a type", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: "s1", withCheckpoints: false });
    const messageId = seeded.userMessageIds[0] as string;

    const plain = await db
      .selectFrom("chat_messages")
      .select("origin_json")
      .where("id", "=", messageId)
      .executeTakeFirstOrThrow();
    expect(plain.origin_json).toBeNull();

    await db
      .updateTable("chat_messages")
      .set({ origin_json: '{"type":"thread-report"}' })
      .where("id", "=", messageId)
      .execute();
    for (const bad of ["[]", '{"kind":"x"}', '{"type":3}', "not json"]) {
      const write = db
        .updateTable("chat_messages")
        .set({ origin_json: bad })
        .where("id", "=", messageId)
        .execute();
      await expect(write).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  test("the delegation table is gone", async () => {
    expect(await tableNames(db)).not.toContain("chat_delegation_runs");
  });
});

describe("migration v4 on a version 2 file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-coordinator-v4-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("keeps projects, sessions, messages and runs, and adds the new columns with defaults", async () => {
    const path = join(dir, "projects.sqlite");
    const v2 = createDatabase(path);
    await applyMigrations(v2, migrationsThrough(2));
    await insertProjectRow(v2, "p1");
    await seedChatSessionGraph(v2, { sessionId: "s1", turns: 2, withCheckpoints: false });
    await v2.destroy();

    const db = createDatabase(path);
    await runMigrations(db);

    const project = await db.selectFrom("projects").selectAll().executeTakeFirstOrThrow();
    expect(project).toMatchObject({ id: "p1", thread_access: "auto-accept-edits" });
    const runs = await db.selectFrom("chat_runs").select("blocks_json").execute();
    expect(runs.map((run) => run.blocks_json)).toEqual(["[]", "[]"]);
    const messages = await db.selectFrom("chat_messages").select("origin_json").execute();
    expect(messages.map((message) => message.origin_json)).toEqual([null, null, null, null]);
    const violations = await sql`PRAGMA foreign_key_check`.execute(db);
    expect(violations.rows).toEqual([]);
    await db.destroy();
  });
});
