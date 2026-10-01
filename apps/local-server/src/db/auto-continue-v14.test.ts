import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v14 on a database that ran versions 1 to 13", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(13));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("turns auto-continue on for every existing project and keeps its settings", async () => {
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider, auto_fix_pull_requests)
      VALUES ('prj_1', 'Checkout', 'claude-code', 'claude-code', 0)
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("projects")
        .select(["name", "auto_fix_pull_requests", "auto_continue"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ name: "Checkout", auto_fix_pull_requests: 0, auto_continue: 1 });
  });

  test("refuses a value that is neither on nor off", async () => {
    await runMigrations(db);

    const insert = sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider, auto_continue)
      VALUES ('prj_2', 'Billing', 'claude-code', 'claude-code', 2)
    `.execute(db);

    await expect(insert).rejects.toThrow(/CHECK constraint failed/);
  });
});
