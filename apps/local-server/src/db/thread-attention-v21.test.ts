import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const WAIT = JSON.stringify({
  reason: "Approve it",
  link: null,
  since: "2026-10-01T10:00:00.000Z",
});

describe("migration v21 on a database that ran versions 1 to 20", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(20));
    await insertProjectRow(db, "prj_1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("leaves existing threads waiting on nothing and their tools sound", async () => {
    await insertProjectSession(db, { id: "isess_1", projectId: "prj_1", kind: "thread" });

    await runMigrations(db);

    expect(
      await db
        .selectFrom("chat_sessions")
        .select(["state", "waiting_on_json", "tools_degraded_json"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "working", waiting_on_json: null, tools_degraded_json: null });
  });

  test("lets only a working thread hold a wait or a degraded mark", async () => {
    await runMigrations(db);
    await insertProjectSession(db, { id: "isess_1", projectId: "prj_1", kind: "thread" });
    await insertProjectSession(
      db,
      { id: "isess_2", projectId: "prj_1", kind: "thread" },
      { state: "idle" },
    );

    await sql`UPDATE chat_sessions SET waiting_on_json = ${WAIT}, tools_degraded_json = ${WAIT} WHERE id = 'isess_1'`.execute(
      db,
    );
    const update = (assignment: string, id: string) =>
      sql.raw(`UPDATE chat_sessions SET ${assignment} WHERE id = '${id}'`).execute(db);

    await expect(update(`waiting_on_json = '${WAIT}'`, "isess_2")).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(update(`tools_degraded_json = '${WAIT}'`, "isess_2")).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(update(`waiting_on_json = '"text"'`, "isess_1")).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });
});
