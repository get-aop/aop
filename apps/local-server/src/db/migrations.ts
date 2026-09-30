import { type Kysely, sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import { BASELINE_V1_STATEMENTS } from "./baseline-v1.ts";
import type { Database } from "./schema.ts";

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/**
 * Append-only. A version that any build has applied must never change; add the
 * next version instead. Versions are recorded in `schema_migrations`, so a step
 * runs once, inside one transaction, and a partial failure leaves no trace.
 */
const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS },
];

export const runMigrations = (db: Kysely<Database>): Promise<void> =>
  applyMigrations(db, MIGRATIONS);

export const applyMigrations = async (
  db: Kysely<Database>,
  migrations: readonly Migration[],
): Promise<void> => {
  await assertNotLegacyDatabase(db);
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  const applied = new Set(
    (await db.selectFrom("schema_migrations").select("version").execute()).map((r) => r.version),
  );
  assertNotNewerThanKnown(applied, migrations);

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await db.transaction().execute(async (trx) => {
      for (const statement of migration.statements) {
        await sql.raw(statement).execute(trx);
      }
      await trx
        .insertInto("schema_migrations")
        .values({ version: migration.version, name: migration.name })
        .execute();
    });
  }

  await insertDefaultSettings(db);
};

/** A file with tables but no version ledger is the old aop.sqlite layout; it is never adopted or altered. */
const assertNotLegacyDatabase = async (db: Kysely<Database>): Promise<void> => {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `.execute(db);
  if (rows.length > 0 && !rows.some((row) => row.name === "schema_migrations")) {
    throw new Error(
      "This database has tables but no schema_migrations ledger, so it was created by an earlier " +
        "AOP layout (aop.sqlite) that is not migrated. Use a new AOP_HOME or database path.",
    );
  }
};

/** Refuses a database written by a newer build instead of running against a schema it cannot read. */
const assertNotNewerThanKnown = (
  applied: ReadonlySet<number>,
  migrations: readonly Migration[],
): void => {
  const newest = Math.max(0, ...applied);
  const known = migrations[migrations.length - 1]?.version ?? 0;
  if (newest > known) {
    throw new Error(
      `Database schema version ${newest} is newer than this build supports (${known}). ` +
        "Upgrade AOP, or point AOP_HOME at a different directory.",
    );
  }
};

const insertDefaultSettings = async (db: Kysely<Database>): Promise<void> => {
  const entries = Object.entries(DEFAULT_SETTINGS) as [SettingKey, string][];

  for (const [key, value] of entries) {
    await db
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();
  }
};
