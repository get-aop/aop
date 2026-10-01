import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v13 on a database that ran versions 1 to 12", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(12));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("gives every project an empty report per role and keeps its settings", async () => {
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, coordinator_model, coordinator_effort,
        thread_provider, thread_model, thread_effort)
      VALUES ('prj_1', 'Checkout', 'claude-code', NULL, 'low', 'claude-code', 'claude-opus-5', 'high')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("projects")
        .select([
          "name",
          "coordinator_effort",
          "thread_model",
          "coordinator_reported_model",
          "coordinator_reported_effort",
          "thread_reported_model",
          "thread_reported_effort",
        ])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      name: "Checkout",
      coordinator_effort: "low",
      thread_model: "claude-opus-5",
      coordinator_reported_model: null,
      coordinator_reported_effort: null,
      thread_reported_model: null,
      thread_reported_effort: null,
    });
    expect(
      (await db.selectFrom("schema_migrations").select("version").execute()).map(
        (row) => row.version,
      ),
    ).toContain(13);
  });
});
