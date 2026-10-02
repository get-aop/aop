import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v20 on a database that ran versions 1 to 19", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(19));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("leaves every existing project on the model's default and keeps its settings", async () => {
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider, auto_continue)
      VALUES ('prj_1', 'Checkout', 'claude-code', 'claude-code', 0)
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("projects")
        .select(["name", "auto_continue", "computer_use"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ name: "Checkout", auto_continue: 0, computer_use: "model-default" });
  });

  test("refuses an option a project cannot hold yet", async () => {
    await runMigrations(db);

    const insert = sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider, computer_use)
      VALUES ('prj_2', 'Billing', 'claude-code', 'claude-code', 'codex')
    `.execute(db);

    await expect(insert).rejects.toThrow(/CHECK constraint failed/);
  });
});
