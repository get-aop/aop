import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { seedChatSessionGraph, seedRevertOperation } from "../chat-session/test-utils.ts";
import { DEFAULT_SETTINGS } from "../settings/types.ts";
import { BASELINE_V1_STATEMENTS } from "./baseline-v1.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, MIGRATIONS, type Migration, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { registeredLedger } from "./test-utils.ts";

const BASELINE_TABLES = [
  "chat_checkpoint_cleanup_jobs",
  "chat_messages",
  "chat_revert_operations",
  "chat_run_changed_files",
  "chat_run_checkpoints",
  "chat_run_events",
  "chat_runs",
  "chat_sessions",
  "repos",
  "runtime_configuration_models",
  "runtime_configuration_providers",
  "schema_migrations",
  "settings",
];

const PROJECT_TABLES = ["devices", "event_log", "memory_files", "project_repos", "projects"];
const USAGE_TABLES = ["run_usage"];
const WATCH_TABLES = ["pull_request_watch"];
const SUGGESTION_TABLES = ["suggestion_answers"];
const KICKOFF_TABLES = ["project_kickoffs"];
const ROUTINE_TABLES = ["routine_runs", "routines"];

const listTables = async (db: Kysely<Database>): Promise<string[]> => {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `.execute(db);
  return rows.map((row) => row.name);
};

describe("runMigrations", () => {
  let db: Kysely<Database>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates the baseline, projects, usage, watch, suggestion, kickoff and routine tables", async () => {
    await runMigrations(db);

    expect(await listTables(db)).toEqual(
      [
        ...BASELINE_TABLES,
        ...PROJECT_TABLES,
        ...USAGE_TABLES,
        ...WATCH_TABLES,
        ...SUGGESTION_TABLES,
        ...KICKOFF_TABLES,
        ...ROUTINE_TABLES,
      ].sort(),
    );
  });

  test("records every registered version, in order", async () => {
    await runMigrations(db);

    const ledger = await db.selectFrom("schema_migrations").selectAll().execute();
    expect(ledger.map(({ version, name }) => ({ version, name }))).toEqual(registeredLedger());
    expect(ledger.length).toBe(MIGRATIONS.length);
  });

  test("seeds default settings and never overwrites a saved value on the next start", async () => {
    await runMigrations(db);
    const seeded = await db.selectFrom("settings").select("key").execute();
    expect(seeded.map((row) => row.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());

    await db
      .updateTable("settings")
      .set({ value: "be brief" })
      .where("key", "=", "chat_global_instructions")
      .execute();
    await runMigrations(db);

    const saved = await db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", "chat_global_instructions")
      .executeTakeFirstOrThrow();
    expect(saved.value).toBe("be brief");
    const ledger = await db.selectFrom("schema_migrations").select("version").execute();
    expect(ledger.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  test("refuses a database written by a newer build", async () => {
    await runMigrations(db);
    await db.insertInto("schema_migrations").values({ version: 99, name: "future" }).execute();

    await expect(runMigrations(db)).rejects.toThrow(/version 99 is newer than this build/);
  });

  test("refuses the old aop.sqlite layout without touching it", async () => {
    await sql`CREATE TABLE tasks (id TEXT PRIMARY KEY)`.execute(db);

    await expect(runMigrations(db)).rejects.toThrow(/no schema_migrations ledger/);
    expect(await listTables(db)).toEqual(["tasks"]);
  });
});

describe("applyMigrations", () => {
  let db: Kysely<Database>;
  const baseline: Migration = { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS };

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("runs only the versions that have not been applied", async () => {
    await applyMigrations(db, [baseline]);
    const second: Migration = {
      version: 2,
      name: "add-note",
      statements: ["CREATE TABLE notes (id TEXT PRIMARY KEY)"],
    };

    await applyMigrations(db, [baseline, second]);
    await applyMigrations(db, [baseline, second]);

    expect(await listTables(db)).toContain("notes");
    const ledger = await db.selectFrom("schema_migrations").select("version").execute();
    expect(ledger.map((row) => row.version)).toEqual([1, 2]);
  });

  test("a failing version leaves no trace and keeps the earlier versions", async () => {
    await applyMigrations(db, [baseline]);
    const broken: Migration = {
      version: 2,
      name: "broken",
      statements: [
        "CREATE TABLE half_done (id TEXT PRIMARY KEY)",
        "CREATE TABLE half_done (id TEXT)",
      ],
    };

    await expect(applyMigrations(db, [baseline, broken])).rejects.toThrow();

    expect(await listTables(db)).not.toContain("half_done");
    const ledger = await db.selectFrom("schema_migrations").select("version").execute();
    expect(ledger.map((row) => row.version)).toEqual([1]);
  });
});

describe("baseline v1 foreign keys", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const count = async (table: keyof Database): Promise<number> => {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  };

  test("enforces foreign keys: a child cannot point at a missing parent", async () => {
    await expect(
      db
        .insertInto("chat_messages")
        .values({ id: "m1", session_id: "missing", role: "user", content: "hi" })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  test("deleting a session cascades to its messages, runs, and run-owned rows", async () => {
    await seedChatSessionGraph(db, { sessionId: "s1", withCheckpoints: false });

    await db.deleteFrom("chat_sessions").where("id", "=", "s1").execute();

    for (const table of [
      "chat_messages",
      "chat_runs",
      "chat_run_events",
      "chat_run_changed_files",
    ] as const) {
      expect(await count(table)).toBe(0);
    }
  });

  test("a run that still owns a checkpoint cannot be deleted by any path", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: "s1", repoId: "r1" });
    const runId = seeded.runIds[0] as string;

    await expect(db.deleteFrom("chat_runs").where("id", "=", runId).execute()).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
    await expect(db.deleteFrom("chat_sessions").where("id", "=", "s1").execute()).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(await count("chat_run_checkpoints")).toBe(1);

    await db.deleteFrom("chat_run_checkpoints").where("run_id", "=", runId).execute();
    await db.deleteFrom("chat_sessions").where("id", "=", "s1").execute();
    expect(await count("chat_runs")).toBe(0);
  });

  test("a repo that still owns a session cannot be deleted", async () => {
    await seedChatSessionGraph(db, { sessionId: "s1", repoId: "r1", withCheckpoints: false });

    await expect(db.deleteFrom("repos").where("id", "=", "r1").execute()).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );

    await db.deleteFrom("chat_sessions").where("id", "=", "s1").execute();
    await db.deleteFrom("repos").where("id", "=", "r1").execute();
    expect(await count("repos")).toBe(0);
  });

  test("deleting the run a retry points at keeps the retry with a null pointer", async () => {
    const seeded = await seedChatSessionGraph(db, {
      sessionId: "s1",
      turns: 2,
      withCheckpoints: false,
    });
    const [original, retry] = seeded.runIds as [string, string];
    await db
      .updateTable("chat_runs")
      .set({ retry_of_run_id: original })
      .where("id", "=", retry)
      .execute();

    await db.deleteFrom("chat_runs").where("id", "=", original).execute();

    const remaining = await db.selectFrom("chat_runs").select(["id", "retry_of_run_id"]).execute();
    expect(remaining).toEqual([{ id: retry, retry_of_run_id: null }]);
  });

  test("runtime models are deleted with their provider", async () => {
    await db
      .insertInto("runtime_configuration_providers")
      .values({ id: "p1", name: "Claude", command: "claude", driver: "claude-code" })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "mdl1",
        provider_id: "p1",
        description: "Sonnet",
        model: "sonnet",
        thinking_levels: "[]",
      })
      .execute();

    await db.deleteFrom("runtime_configuration_providers").where("id", "=", "p1").execute();

    expect(await count("runtime_configuration_models")).toBe(0);
  });

  test("cleanup ledgers outlive the session rows they describe", async () => {
    await seedRevertOperation(db, {
      id: "rev1",
      sessionId: "session-already-deleted",
      targetRunId: "r",
      targetUserMessageId: "u",
      targetAssistantMessageId: "a",
      targetTurnIndex: 0,
    });

    expect(await count("chat_revert_operations")).toBe(1);
  });
});
