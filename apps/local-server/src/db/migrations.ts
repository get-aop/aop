import { type Kysely, sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import { AUTO_CONTINUE_V14_STATEMENTS } from "./auto-continue-v14.ts";
import { BASELINE_V1_STATEMENTS } from "./baseline-v1.ts";
import { COORDINATOR_V4_STATEMENTS } from "./coordinator-v4.ts";
import { DEFAULT_RUNTIME_V9_STATEMENTS } from "./default-runtime-v9.ts";
import { DROP_RUNTIME_PROFILES_V11_STATEMENTS } from "./drop-runtime-profiles-v11.ts";
import { EXEC_HOSTS_V8_STATEMENTS } from "./exec-hosts-v8.ts";
import { PROJECT_APPEARANCE_V15_STATEMENTS } from "./project-appearance-v15.ts";
import { PROJECT_KICKOFF_V12_STATEMENTS } from "./project-kickoff-v12.ts";
import { PROJECTS_V2_STATEMENTS } from "./projects-v2.ts";
import { PULL_REQUEST_WATCH_V7_STATEMENTS } from "./pull-request-watch-v7.ts";
import { REPORTED_RUNTIME_V13_STATEMENTS } from "./reported-runtime-v13.ts";
import { RUN_CLI_VERSION_V17_STATEMENTS } from "./run-cli-version-v17.ts";
import { RUN_PERMISSIONS_V19_STATEMENTS } from "./run-permissions-v19.ts";
import { SCHEDULING_V5_STATEMENTS } from "./scheduling-v5.ts";
import type { Database } from "./schema.ts";
import { STEER_DELIVERY_V18_STATEMENTS } from "./steer-delivery-v18.ts";
import { SUGGESTION_ANSWERS_V10_STATEMENTS } from "./suggestion-answers-v10.ts";
import { THREAD_GIT_V6_STATEMENTS } from "./thread-git-v6.ts";
import { TURN_PARTS_V16_STATEMENTS } from "./turn-parts-v16.ts";
import { USAGE_V3_STATEMENTS } from "./usage-v3.ts";

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
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS },
  { version: 2, name: "projects", statements: PROJECTS_V2_STATEMENTS },
  { version: 3, name: "run-usage", statements: USAGE_V3_STATEMENTS },
  { version: 4, name: "coordinator", statements: COORDINATOR_V4_STATEMENTS },
  { version: 5, name: "scheduling", statements: SCHEDULING_V5_STATEMENTS },
  { version: 6, name: "thread-pull-request", statements: THREAD_GIT_V6_STATEMENTS },
  { version: 7, name: "pull-request-watch", statements: PULL_REQUEST_WATCH_V7_STATEMENTS },
  { version: 8, name: "remove-exec-hosts", statements: EXEC_HOSTS_V8_STATEMENTS },
  { version: 9, name: "default-runtime", statements: DEFAULT_RUNTIME_V9_STATEMENTS },
  { version: 10, name: "suggestion-answers", statements: SUGGESTION_ANSWERS_V10_STATEMENTS },
  { version: 11, name: "drop-runtime-profiles", statements: DROP_RUNTIME_PROFILES_V11_STATEMENTS },
  { version: 12, name: "project-kickoff", statements: PROJECT_KICKOFF_V12_STATEMENTS },
  { version: 13, name: "reported-runtime", statements: REPORTED_RUNTIME_V13_STATEMENTS },
  { version: 14, name: "auto-continue", statements: AUTO_CONTINUE_V14_STATEMENTS },
  { version: 15, name: "project-appearance", statements: PROJECT_APPEARANCE_V15_STATEMENTS },
  { version: 16, name: "turn-parts", statements: TURN_PARTS_V16_STATEMENTS },
  { version: 17, name: "run-cli-version", statements: RUN_CLI_VERSION_V17_STATEMENTS },
  { version: 18, name: "steer-delivery", statements: STEER_DELIVERY_V18_STATEMENTS },
  { version: 19, name: "run-permissions", statements: RUN_PERMISSIONS_V19_STATEMENTS },
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
