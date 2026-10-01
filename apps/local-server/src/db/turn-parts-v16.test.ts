import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v16 on a database that ran the versions before it", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(15));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("gives every message no parts, and keeps its content and activity", async () => {
    await sql`
      INSERT INTO chat_sessions (id, title, runtime) VALUES ('s1', 'Chat', 'claude-code')
    `.execute(db);
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content, activity)
      VALUES ('m1', 's1', 'assistant', 'Done.', '{"content":"Looking.\n\nDone."}')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("chat_messages")
        .select(["content", "activity", "parts"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ content: "Done.", activity: '{"content":"Looking.\n\nDone."}', parts: null });
    expect(
      (await db.selectFrom("schema_migrations").select("version").execute()).map(
        (row) => row.version,
      ),
    ).toContain(16);
  });
});
