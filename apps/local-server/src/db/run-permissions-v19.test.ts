import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v19 on a database that ran the versions before it", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(18));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("gives every earlier run no permission record and keeps the rest of the row", async () => {
    await sql`
      INSERT INTO chat_sessions (id, title, runtime) VALUES ('s1', 'Chat', 'claude-code')
    `.execute(db);
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'Hi')
    `.execute(db);
    await sql`
      INSERT INTO chat_runs (id, session_id, user_message_id, assistant_message_id, runtime, log_file_path, status)
      VALUES ('r1', 's1', 'm1', 'm2', 'claude-code', '/tmp/r1.jsonl', 'completed')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("chat_runs")
        .select(["id", "status", "permissions_bypassed"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: "r1", status: "completed", permissions_bypassed: null });
    expect(
      (await db.selectFrom("schema_migrations").select("version").execute()).map(
        (row) => row.version,
      ),
    ).toContain(19);
  });
});
