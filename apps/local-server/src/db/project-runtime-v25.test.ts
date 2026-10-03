import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v25 on a database that ran versions 1 to 24", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(24));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("puts every existing project on the built-in runtime and keeps its settings", async () => {
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, coordinator_model, thread_provider, thread_effort)
      VALUES ('prj_1', 'Checkout', 'claude-code', 'claude-opus-5-5', 'claude-code', 'high')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("projects")
        .select([
          "name",
          "coordinator_model",
          "thread_effort",
          "coordinator_runtime_id",
          "thread_runtime_id",
        ])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      name: "Checkout",
      coordinator_model: "claude-opus-5-5",
      thread_effort: "high",
      coordinator_runtime_id: "claude-code",
      thread_runtime_id: "claude-code",
    });
  });

  test("stores a custom runtime per role", async () => {
    await runMigrations(db);

    await sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider, coordinator_runtime_id, thread_runtime_id)
      VALUES ('prj_2', 'Billing', 'claude-code', 'claude-code', 'rtprov_a', 'rtprov_b')
    `.execute(db);

    expect(
      await db
        .selectFrom("projects")
        .select(["coordinator_runtime_id", "thread_runtime_id"])
        .where("id", "=", "prj_2")
        .executeTakeFirstOrThrow(),
    ).toEqual({ coordinator_runtime_id: "rtprov_a", thread_runtime_id: "rtprov_b" });
  });
});
