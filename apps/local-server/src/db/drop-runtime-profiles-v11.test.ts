import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const tableNames = async (db: Kysely<Database>): Promise<string[]> => {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `.execute(db);
  return rows.map((row) => row.name);
};

const insertProfile = (
  db: Kysely<Database>,
  profile: { id: string; name: string; command: string; reasoning: string; fastMode?: number },
) =>
  sql`
    INSERT INTO runtime_profiles (id, name, base_provider, command, model, reasoning, fast_mode)
    VALUES (${profile.id}, ${profile.name}, 'claude-code', ${profile.command}, 'claude-fable-5',
      ${profile.reasoning}, ${profile.fastMode ?? 0})
  `.execute(db);

describe("migration v11 on a database that ran versions 1 to 10", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(10));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("drops the profiles table and leaves every other table and row alone", async () => {
    await db
      .updateTable("settings")
      .set({ value: "be brief" })
      .where("key", "=", "chat_global_instructions")
      .execute();
    const before = (await tableNames(db)).filter((name) => name !== "runtime_profiles");

    await runMigrations(db);

    expect(await tableNames(db)).toEqual(before);
    expect(
      await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", "chat_global_instructions")
        .executeTakeFirstOrThrow(),
    ).toEqual({ value: "be brief" });
    expect((await sql`PRAGMA foreign_key_check`.execute(db)).rows).toEqual([]);
    expect((await db.selectFrom("schema_migrations").select("version").execute()).at(-1)).toEqual({
      version: 11,
    });
  });

  test("a profile that was never copied becomes a custom provider before the table goes", async () => {
    await insertProfile(db, {
      id: "rprof_work",
      name: "Work Claude",
      command: "claude --work",
      reasoning: "high",
      fastMode: 1,
    });

    await runMigrations(db);

    expect(
      await db
        .selectFrom("runtime_configuration_providers")
        .selectAll()
        .where("id", "=", "legacy_rprof_work")
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      name: "Work Claude",
      command: "claude",
      driver: "claude-code",
      built_in: 0,
      supports_fast_mode: 1,
    });
    expect(
      await db
        .selectFrom("runtime_configuration_models")
        .selectAll()
        .where("provider_id", "=", "legacy_rprof_work")
        .execute(),
    ).toMatchObject([
      {
        id: "legacy_rprof_work_model",
        model: "claude-fable-5",
        thinking_levels: '["high"]',
        default_thinking_level: "high",
        is_default: 1,
        built_in: 0,
      },
    ]);
  });

  test("a profile already copied by an earlier start is not copied twice", async () => {
    await insertProfile(db, { id: "rprof_a", name: "Alpha", command: "claude", reasoning: "low" });
    await db
      .insertInto("runtime_configuration_providers")
      .values({ id: "legacy_rprof_a", name: "Alpha", command: "claude", driver: "claude-code" })
      .execute();

    await runMigrations(db);

    const providers = await db
      .selectFrom("runtime_configuration_providers")
      .select("id")
      .where("id", "=", "legacy_rprof_a")
      .execute();
    expect(providers).toHaveLength(1);
  });

  test("a fresh database never has the table", async () => {
    const fresh = createDatabase(":memory:");
    await runMigrations(fresh);

    expect(await tableNames(fresh)).not.toContain("runtime_profiles");
    await fresh.destroy();
  });
});
