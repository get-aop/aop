import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THREAD_STATUSES, type ThreadStatus } from "@aop/common";
import { type Insertable, type Kysely, sql } from "kysely";
import { seedChatSessionGraph, seedRepoRow } from "../chat-session/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { BASELINE_V1_STATEMENTS } from "./baseline-v1.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { ChatSessionsTable, Database } from "./schema.ts";

const THREAD_COLUMNS = [
  "project_id",
  "kind",
  "state",
  "blocked_question_json",
  "steps_json",
  "status_line",
  "branch",
  "pr_number",
  "pr_url",
  "pr_state",
  "target_json",
  "last_activity_at",
  "unread",
  "resolved_at",
];

const listColumns = async (db: Kysely<Database>, table: string): Promise<string[]> => {
  const { rows } = await sql<{
    name: string;
  }>`SELECT name FROM pragma_table_info(${table})`.execute(db);
  return rows.map((row) => row.name);
};

const listLedger = (db: Kysely<Database>) =>
  db.selectFrom("schema_migrations").selectAll().orderBy("version").execute();

const count = async (db: Kysely<Database>, table: keyof Database): Promise<number> => {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
};

describe("migration v2 on a database file", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-projects-v2-"));
    path = join(dir, "projects.sqlite");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a fresh file gets every version and every thread column", async () => {
    const db = createDatabase(path);
    await runMigrations(db);

    expect((await listLedger(db)).map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "baseline" },
      { version: 2, name: "projects" },
      { version: 3, name: "run-usage" },
      { version: 4, name: "coordinator" },
    ]);
    expect(await listColumns(db, "chat_sessions")).toEqual(expect.arrayContaining(THREAD_COLUMNS));
    await db.destroy();
  });

  test("an existing v1 file is upgraded once and keeps its sessions", async () => {
    const v1 = createDatabase(path);
    await applyMigrations(v1, [
      { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS },
    ]);
    await seedChatSessionGraph(v1, {
      sessionId: "legacy",
      repoId: "r1",
      turns: 2,
      withCheckpoints: false,
    });
    const ledgerV1 = await listLedger(v1);
    expect(await listColumns(v1, "chat_sessions")).not.toContain("project_id");
    await v1.destroy();

    // A new connection, as after a server restart on a home that already ran v1.
    const db = createDatabase(path);
    await runMigrations(db);

    const ledger = await listLedger(db);
    expect(ledger.map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect(ledger[0]).toEqual(ledgerV1[0]);

    const legacy = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("id", "=", "legacy")
      .executeTakeFirstOrThrow();
    expect(legacy).toMatchObject({
      repo_id: "r1",
      project_id: null,
      kind: null,
      state: null,
      blocked_question_json: null,
      steps_json: "[]",
      status_line: null,
      branch: null,
      pr_number: null,
      pr_url: null,
      pr_state: null,
      target_json: '{"kind":"host"}',
      last_activity_at: null,
      unread: 0,
      resolved_at: null,
    });
    expect(await count(db, "chat_messages")).toBe(4);
    expect(await count(db, "chat_runs")).toBe(2);
    const violations = await sql`PRAGMA foreign_key_check`.execute(db);
    expect(violations.rows).toEqual([]);

    await runMigrations(db);
    expect(await listLedger(db)).toEqual(ledger);
    await db.destroy();
  });

  test("a version 2 that fails part-way leaves the v1 file exactly as it was", async () => {
    const db = createDatabase(path);
    await applyMigrations(db, [
      { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS },
    ]);
    // Taken name: the last statements of v2, after its tables and columns, cannot run.
    await sql`CREATE INDEX idx_chat_sessions_project_state ON repos(name)`.execute(db);

    await expect(runMigrations(db)).rejects.toThrow(/already exists/);

    expect((await listLedger(db)).map((row) => row.version)).toEqual([1]);
    expect(await listColumns(db, "chat_sessions")).not.toContain("project_id");
    const { rows } = await sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'
    `.execute(db);
    expect(rows).toEqual([]);
    await db.destroy();
  });
});

describe("projects v2 foreign keys", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("deleting a project removes its repo links and memory but not the repos", async () => {
    await seedRepoRow(db, "r1");
    await db
      .insertInto("project_repos")
      .values({ project_id: "p1", repo_id: "r1", position: 0 })
      .execute();
    await db
      .insertInto("memory_files")
      .values({ project_id: "p1", name: "MEMORY.md", description: "index", body: "- a" })
      .execute();

    await db.deleteFrom("projects").where("id", "=", "p1").execute();

    expect(await count(db, "project_repos")).toBe(0);
    expect(await count(db, "memory_files")).toBe(0);
    expect(await count(db, "repos")).toBe(1);
  });

  test("a repo attached to a project cannot be deleted until it is detached", async () => {
    await seedRepoRow(db, "r1");
    await db
      .insertInto("project_repos")
      .values({ project_id: "p1", repo_id: "r1", position: 0 })
      .execute();

    await expect(db.deleteFrom("repos").where("id", "=", "r1").execute()).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );

    await db.deleteFrom("project_repos").where("repo_id", "=", "r1").execute();
    await db.deleteFrom("repos").where("id", "=", "r1").execute();
    expect(await count(db, "repos")).toBe(0);
  });

  test("a repo can be attached to a project once", async () => {
    await seedRepoRow(db, "r1");
    const link = { project_id: "p1", repo_id: "r1", position: 0 };
    await db.insertInto("project_repos").values(link).execute();

    await expect(
      db
        .insertInto("project_repos")
        .values({ ...link, position: 1 })
        .execute(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("a project that still has sessions cannot be deleted", async () => {
    await insertProjectSession(db, { id: "coordinator-1", projectId: "p1", kind: "coordinator" });
    await insertProjectSession(db, { id: "thread-1", projectId: "p1", kind: "thread" });

    await expect(db.deleteFrom("projects").where("id", "=", "p1").execute()).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );

    await db.deleteFrom("chat_sessions").where("project_id", "=", "p1").execute();
    await db.deleteFrom("projects").where("id", "=", "p1").execute();
    expect(await count(db, "projects")).toBe(0);
  });

  test("a session cannot name a project that does not exist", async () => {
    await expect(
      insertProjectSession(db, { id: "thread-1", projectId: "missing", kind: "thread" }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  test("event_log entries outlive the project they describe", async () => {
    await db
      .insertInto("event_log")
      .values({ project_id: "p1", type: "project.removed", payload: "{}" })
      .execute();

    await db.deleteFrom("projects").where("id", "=", "p1").execute();

    expect(await count(db, "event_log")).toBe(1);
  });
});

describe("projects v2 timestamps", () => {
  test("column defaults are ISO-8601 instants, the form the wire schemas accept", async () => {
    const db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    await db.insertInto("devices").values({ id: "d1", name: "Mac", token_hash: "h" }).execute();

    const project = await db
      .selectFrom("projects")
      .select(["created_at", "updated_at"])
      .executeTakeFirstOrThrow();
    const device = await db.selectFrom("devices").select("created_at").executeTakeFirstOrThrow();

    for (const stamp of [project.created_at, project.updated_at, device.created_at]) {
      expect(new Date(stamp).toISOString()).toBe(stamp);
    }
    await db.destroy();
  });
});

describe("projects v2 event_log and devices", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const appendEvent = async (): Promise<number> => {
    const row = await db
      .insertInto("event_log")
      .values({ project_id: "p1", type: "thread.removed", payload: '{"threadId":"t1"}' })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  };

  test("event ids only grow, even after the newest entry is trimmed", async () => {
    const first = await appendEvent();
    const second = await appendEvent();
    expect(second).toBeGreaterThan(first);

    await db.deleteFrom("event_log").where("id", "=", second).execute();
    const third = await appendEvent();

    expect(third).toBeGreaterThan(second);
  });

  test("an event payload must be a JSON object", async () => {
    for (const payload of ["not json", "[]", '"text"']) {
      await expect(
        db.insertInto("event_log").values({ project_id: "p1", type: "x", payload }).execute(),
      ).rejects.toThrow();
    }
  });

  test("two devices cannot share a token hash", async () => {
    await db.insertInto("devices").values({ id: "d1", name: "Mac", token_hash: "h" }).execute();

    await expect(
      db.insertInto("devices").values({ id: "d2", name: "PC", token_hash: "h" }).execute(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("projects v2 thread columns", () => {
  let db: Kysely<Database>;
  let next = 0;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
  });

  afterEach(async () => {
    await db.destroy();
  });

  type Columns = Partial<Insertable<ChatSessionsTable>>;

  const insertThread = (columns: Columns = {}) => {
    next += 1;
    return insertProjectSession(
      db,
      { id: `thread-${next}`, projectId: "p1", kind: "thread" },
      columns,
    );
  };

  const question = JSON.stringify({ question: "Ship it?", options: [] });
  const resolvedAt = "2026-09-30T10:00:00.000Z";

  // One valid set of state-bound columns per status. Adding a status to @aop/common makes
  // this table fail to compile until its coupling to those columns has been decided.
  const validColumns: Record<ThreadStatus, Columns> = {
    "waiting-on-you": { blocked_question_json: question },
    working: {},
    "ready-for-review": {},
    landing: { pr_number: 7, pr_url: "https://github.com/o/r/pull/7", pr_state: "open" },
    idle: {},
    resolved: { resolved_at: resolvedAt },
  };

  test.each(THREAD_STATUSES.map((status) => [status]))("accepts a %s thread", async (status) => {
    await insertThread({ state: status, ...validColumns[status] });

    const row = await db
      .selectFrom("chat_sessions")
      .select("state")
      .where("kind", "=", "thread")
      .executeTakeFirstOrThrow();
    expect(row.state).toBe(status);
  });

  const rejected: [string, Columns][] = [
    ["a thread without a state", { state: null }],
    ["a thread without a last activity time", { last_activity_at: null }],
    ["a kind without a project", { project_id: null }],
    ["a project without a kind", { kind: null, state: null }],
    ["a waiting thread without a question", { state: "waiting-on-you" }],
    ["a question on a thread that is not waiting", { blocked_question_json: question }],
    ["a question that is not an object", { state: "waiting-on-you", blocked_question_json: "[]" }],
    ["a resolved thread without a resolution time", { state: "resolved" }],
    ["a resolution time on a thread that is not resolved", { resolved_at: resolvedAt }],
    ["a landing thread without a pull request", { state: "landing" }],
    ["a pull request number without a url", { pr_number: 4, pr_state: "open" }],
    ["a pull request url without a number", { pr_url: "https://github.com/o/r/pull/4" }],
    ["a pull request without a state", { pr_number: 4, pr_url: "https://github.com/o/r/pull/4" }],
    ["a checklist that is not an array", { steps_json: "{}" }],
    ["a checklist that is not JSON", { steps_json: "[" }],
    ["a target without a kind", { target_json: "{}" }],
    ["a target that is not JSON", { target_json: "host" }],
  ];

  test.each(rejected)("rejects %s", async (_label, columns) => {
    await expect(insertThread(columns)).rejects.toThrow(/CHECK constraint failed/);
  });

  test("rejects a coordinator that carries thread state", async () => {
    await expect(
      insertProjectSession(
        db,
        { id: "coordinator-1", projectId: "p1", kind: "coordinator" },
        { state: "working" },
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  test("unread is 0 or 1", async () => {
    await insertThread();

    await expect(sql`UPDATE chat_sessions SET unread = 2`.execute(db)).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });

  test("a status change has to move its dependent columns in the same statement", async () => {
    await insertThread({ id: "t-wait", state: "waiting-on-you", blocked_question_json: question });

    await expect(
      db
        .updateTable("chat_sessions")
        .set({ state: "working" })
        .where("id", "=", "t-wait")
        .execute(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await db
      .updateTable("chat_sessions")
      .set({ state: "working", blocked_question_json: null })
      .where("id", "=", "t-wait")
      .execute();
  });

  test("a project has one coordinator and any number of threads", async () => {
    await insertProjectSession(db, { id: "coordinator-1", projectId: "p1", kind: "coordinator" });
    await insertProjectSession(db, { id: "coordinator-2", projectId: "p2", kind: "coordinator" });
    await insertThread();
    await insertThread();

    await expect(
      insertProjectSession(db, { id: "coordinator-3", projectId: "p1", kind: "coordinator" }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("a session outside any project needs none of the new columns", async () => {
    await db
      .insertInto("chat_sessions")
      .values({
        id: "plain",
        repo_id: null,
        title: "plain",
        runtime: "claude-code",
        runtime_configuration_id: null,
        model: "m",
        reasoning_effort: "medium",
        runtime_alias: null,
        runtime_session_id: null,
        workspace_path: null,
      })
      .execute();

    const row = await db
      .selectFrom("chat_sessions")
      .select(["project_id", "kind", "state"])
      .where("id", "=", "plain")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ project_id: null, kind: null, state: null });
  });
});
