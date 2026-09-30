import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const listColumns = async (db: Kysely<Database>, table: string): Promise<string[]> => {
  const { rows } = await sql<{
    name: string;
  }>`SELECT name FROM pragma_table_info(${table})`.execute(db);
  return rows.map((row) => row.name);
};

const listSettingKeys = async (db: Kysely<Database>): Promise<string[]> =>
  (await db.selectFrom("settings").select("key").execute()).map((row) => row.key);

describe("migration v8 on a database that ran versions 1 to 7", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-exec-hosts-v8-"));
    path = join(dir, "projects.sqlite");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const seedVersion7 = async () => {
    const db = createDatabase(path);
    await applyMigrations(db, migrationsThrough(7));
    await sql`
      INSERT INTO runtime_profiles (id, name, base_provider, command, model, reasoning, exec_host_id)
      VALUES ('rprof_1', 'Work', 'claude-code', 'claude', 'claude-opus-5', 'high', 'ehost_desktop')
    `.execute(db);
    await sql`
      INSERT INTO settings (key, value) VALUES ('remote_exec_hosts_json', '[{"id":"ehost_desktop"}]')
    `.execute(db);
    await db
      .updateTable("settings")
      .set({ value: "be brief" })
      .where("key", "=", "chat_global_instructions")
      .execute();
    await db.destroy();
  };

  test("drops the host column, keeps the profile, and removes the host list setting", async () => {
    await seedVersion7();
    const before = createDatabase(path);
    expect(await listColumns(before, "runtime_profiles")).toContain("exec_host_id");
    expect(await listSettingKeys(before)).toContain("remote_exec_hosts_json");
    await before.destroy();

    const db = createDatabase(path);
    await applyMigrations(db, migrationsThrough(8));

    expect(await listColumns(db, "runtime_profiles")).not.toContain("exec_host_id");
    expect(
      await sql`SELECT id, name, command, model FROM runtime_profiles`
        .execute(db)
        .then(({ rows }) => rows),
    ).toEqual([{ id: "rprof_1", name: "Work", command: "claude", model: "claude-opus-5" }]);
    expect(await listSettingKeys(db)).not.toContain("remote_exec_hosts_json");
    expect(
      await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", "chat_global_instructions")
        .executeTakeFirstOrThrow(),
    ).toEqual({ value: "be brief" });
    const violations = await sql`PRAGMA foreign_key_check`.execute(db);
    expect(violations.rows).toEqual([]);

    const ledger = await db.selectFrom("schema_migrations").selectAll().execute();
    await applyMigrations(db, migrationsThrough(8));
    expect(await db.selectFrom("schema_migrations").selectAll().execute()).toEqual(ledger);
    await db.destroy();
  });

  test("a fresh database never has the setting", async () => {
    const db = createDatabase(path);
    await runMigrations(db);

    expect(await listSettingKeys(db)).not.toContain("remote_exec_hosts_json");
    await db.destroy();
  });
});
