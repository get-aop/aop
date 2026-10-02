import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const SHA = "a".repeat(64);
const NOW = "2026-10-02T09:00:00.000Z";

describe("migration v22 on a database that ran versions 1 to 21", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(21));
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider)
      VALUES ('prj_1', 'Checkout', 'claude-code', 'claude-code')
    `.execute(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const insert = (columns: Record<string, unknown>) =>
    db
      .insertInto("library_items")
      .values({
        id: `lib_${crypto.randomUUID()}`,
        project_id: "prj_1",
        source: "upload",
        name: "a.txt",
        mime_type: "text/plain",
        size: 1,
        sha256: SHA,
        session_id: null,
        message_id: null,
        attachment_file: null,
        created_at: NOW,
        added_at: NOW,
        updated_at: NOW,
        last_accessed_at: NOW,
        ...columns,
      } as never)
      .execute();

  test("keeps the project's items and settings with it, and deletes them with it", async () => {
    await insert({});
    await db
      .insertInto("library_settings")
      .values({ project_id: "prj_1", retention_days: 7, cap_mb: null })
      .execute();

    await db.deleteFrom("projects").where("id", "=", "prj_1").execute();

    expect(await db.selectFrom("library_items").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("library_settings").selectAll().execute()).toEqual([]);
  });

  test("a chat item names its message and file, and only a chat item may stay as a removed marker", async () => {
    await expect(insert({ source: "chat" })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert({ removed_at: NOW, removed_reason: "expired" })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ removed_at: NOW })).rejects.toThrow(/CHECK constraint failed/);

    const chat = {
      source: "chat",
      session_id: "isess_1",
      message_id: "smsg_1",
      attachment_file: "smsg_1-1.png",
    };
    await insert({ ...chat, removed_at: NOW, removed_reason: "expired" });
    await expect(insert(chat)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("refuses a bad hash, source or pin", async () => {
    await expect(insert({ sha256: "short" })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert({ source: "web" })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert({ pinned: 2 })).rejects.toThrow(/CHECK constraint failed/);
  });
});
