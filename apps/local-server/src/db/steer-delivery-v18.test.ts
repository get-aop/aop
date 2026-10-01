import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v18 on a database that ran the versions before it", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(17));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("earlier runs take no steers and earlier messages were written into none", async () => {
    await sql`
      INSERT INTO chat_sessions (id, title, runtime) VALUES ('s1', 'Chat', 'claude-code')
    `.execute(db);
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'Hi')
    `.execute(db);
    await sql`
      INSERT INTO chat_runs (id, session_id, user_message_id, assistant_message_id, runtime, log_file_path, status)
      VALUES ('r1', 's1', 'm1', 'm2', 'claude-code', '/tmp/r1.jsonl', 'running')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db.selectFrom("chat_runs").select(["id", "input_path"]).executeTakeFirstOrThrow(),
    ).toEqual({ id: "r1", input_path: null });
    expect(
      await db
        .selectFrom("chat_messages")
        .select(["id", "content", "steered_run_id"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: "m1", content: "Hi", steered_run_id: null });
  });
});
