import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v15 on a database that ran the versions before it", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(14));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("gives every project no icon and no colour, and keeps its settings", async () => {
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, coordinator_model, coordinator_effort,
        thread_provider, thread_model, thread_effort)
      VALUES ('prj_1', 'Checkout', 'claude-code', NULL, 'low', 'claude-code', 'claude-opus-5', 'high')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("projects")
        .select(["name", "thread_model", "icon", "color"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ name: "Checkout", thread_model: "claude-opus-5", icon: null, color: null });
    expect(
      (await db.selectFrom("schema_migrations").select("version").execute()).map(
        (row) => row.version,
      ),
    ).toContain(15);
  });
});
