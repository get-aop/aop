import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("db/migrations", () => {
  let db: Kysely<Database>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates Linear linkage tables in the current bootstrap flow", async () => {
    await runMigrations(db);

    const tables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('task_sources', 'task_dependencies')
    `.execute(db);

    expect(tables.rows.map((table) => table.name).sort()).toEqual([
      "task_dependencies",
      "task_sources",
    ]);
  });

  test("creates archived_at on fresh task tables", async () => {
    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);

    expect(columns.rows.some((column) => column.name === "archived_at")).toBe(true);
  });

  test("creates origin_chat_session_id on fresh task tables", async () => {
    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);

    expect(columns.rows.some((column) => column.name === "origin_chat_session_id")).toBe(true);
  });

  test("repairs legacy task status notes to the end of each chat", async () => {
    await runMigrations(db);
    await sql`INSERT INTO chat_sessions (
      id, title, runtime, model, reasoning_effort, created_at, updated_at
    ) VALUES (
      'session-notes', 'Notes', 'claude-code', 'claude', 'medium', '2026-01-01', '2026-01-01'
    )`.execute(db);
    await sql`INSERT INTO chat_messages (
      id, session_id, role, content, action, turn_index, created_at
    ) VALUES
      ('normal', 'session-notes', 'assistant', 'Normal', NULL, 7, '2026-01-01'),
      ('done', 'session-notes', 'assistant', 'Done', '{"type":"task","label":"Task done"}', 0, '2026-01-02'),
      ('blocked', 'session-notes', 'assistant', 'Blocked', '{"type":"task","label":"Task blocked"}', 0, '2026-01-03')`.execute(
      db,
    );

    await runMigrations(db);

    const notes = await db
      .selectFrom("chat_messages")
      .select(["id", "turn_index"])
      .where("id", "in", ["done", "blocked"])
      .orderBy("turn_index")
      .execute();
    expect(notes).toEqual([
      { id: "done", turn_index: 8 },
      { id: "blocked", turn_index: 9 },
    ]);
  });

  test("creates branch_name on fresh task tables", async () => {
    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);

    expect(columns.rows.some((column) => column.name === "branch_name")).toBe(true);
  });

  test("creates chat sessions that support repository-free general conversations", async () => {
    await runMigrations(db);

    const columns = await sql<{ name: string; notnull: number }>`
      PRAGMA table_info(chat_sessions)
    `.execute(db);

    expect(columns.rows.find((column) => column.name === "repo_id")?.notnull).toBe(0);
  });

  test("removes retired Claude endpoint override columns", async () => {
    await sql`
      CREATE TABLE runtime_configuration_providers (
        id text PRIMARY KEY,
        name text NOT NULL,
        command text NOT NULL,
        driver text NOT NULL,
        endpoint_url text,
        endpoint_token text,
        endpoint_kind text,
        endpoint_override_enabled integer NOT NULL DEFAULT 0,
        built_in integer NOT NULL DEFAULT 0,
        position integer NOT NULL DEFAULT 0,
        supports_fast_mode integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE runtime_configuration_models (
        id text PRIMARY KEY,
        provider_id text NOT NULL,
        description text NOT NULL,
        model text NOT NULL,
        thinking_levels text NOT NULL,
        fast_mode integer NOT NULL DEFAULT 0,
        built_in integer NOT NULL DEFAULT 0,
        position integer NOT NULL DEFAULT 0,
        is_default integer NOT NULL DEFAULT 0,
        default_thinking_level text,
        compact_context_window integer,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);

    await runMigrations(db);

    const providerColumns = await sql<{ name: string }>`
      PRAGMA table_info(runtime_configuration_providers)
    `.execute(db);
    const modelColumns = await sql<{ name: string }>`
      PRAGMA table_info(runtime_configuration_models)
    `.execute(db);
    expect(providerColumns.rows.map((column) => column.name)).not.toEqual(
      expect.arrayContaining([
        "endpoint_url",
        "endpoint_token",
        "endpoint_kind",
        "endpoint_override_enabled",
      ]),
    );
    expect(modelColumns.rows.map((column) => column.name)).not.toContain("compact_context_window");
  });

  test("preserves existing repository conversations when making repo_id nullable", async () => {
    await sql`
      CREATE TABLE repos (
        id text PRIMARY KEY,
        path text NOT NULL UNIQUE,
        name text,
        remote_origin text,
        max_concurrent_tasks integer DEFAULT 3,
        created_at text NOT NULL DEFAULT (datetime('now')),
        updated_at text NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(db);
    await sql`
      CREATE TABLE chat_sessions (
        id text PRIMARY KEY,
        repo_id text NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        title text NOT NULL,
        named integer NOT NULL DEFAULT 0,
        runtime text NOT NULL,
        model text NOT NULL,
        reasoning_effort text NOT NULL,
        runtime_alias text,
        runtime_session_id text,
        pinned integer NOT NULL DEFAULT 0,
        archived integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE chat_messages (
        id text PRIMARY KEY,
        session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        action text,
        created_at text NOT NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO repos (id, path, name) VALUES ('repo-old', '/tmp/repo-old', 'repo-old')
    `.execute(db);
    await sql`
      INSERT INTO chat_sessions (
        id, repo_id, title, runtime, model, reasoning_effort, created_at, updated_at
      ) VALUES (
        'session-old', 'repo-old', 'Existing chat', 'claude-code', 'claude', 'medium',
        '2026-01-01', '2026-01-01'
      )
    `.execute(db);
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content, created_at)
      VALUES ('message-old', 'session-old', 'user', 'Keep me', '2026-01-01')
    `.execute(db);

    await runMigrations(db);

    expect(
      await db
        .selectFrom("chat_sessions")
        .select(["id", "repo_id", "runtime_access_mode"])
        .executeTakeFirst(),
    ).toEqual({
      id: "session-old",
      repo_id: "repo-old",
      runtime_access_mode: "full-access",
    });
    expect(
      await db.selectFrom("chat_messages").select(["id", "session_id"]).executeTakeFirst(),
    ).toEqual({ id: "message-old", session_id: "session-old" });
  });

  test("adds model ordering and default preferences to existing runtime configuration tables", async () => {
    await sql`
      CREATE TABLE runtime_configuration_providers (
        id text PRIMARY KEY,
        name text NOT NULL,
        command text NOT NULL,
        driver text NOT NULL,
        endpoint_url text,
        built_in integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE runtime_configuration_models (
        id text PRIMARY KEY,
        provider_id text NOT NULL,
        description text NOT NULL,
        model text NOT NULL,
        thinking_levels text NOT NULL,
        fast_mode integer NOT NULL DEFAULT 0,
        built_in integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO runtime_configuration_providers
        (id, name, command, driver, endpoint_url, created_at, updated_at)
      VALUES (
        'custom', 'Custom', 'custom', 'claude-code', 'https://gateway.example.com',
        '2026-01-01', '2026-01-01'
      )
    `.execute(db);
    await sql`
      INSERT INTO runtime_configuration_models
        (id, provider_id, description, model, thinking_levels, created_at, updated_at)
      VALUES
        ('first', 'custom', 'First', 'first', '["low","high"]', '2026-01-01', '2026-01-01'),
        ('second', 'custom', 'Second', 'second', '[]', '2026-01-02', '2026-01-02')
    `.execute(db);

    await runMigrations(db);

    const models = await db
      .selectFrom("runtime_configuration_models")
      .select(["id", "position", "is_default", "default_thinking_level"])
      .where("provider_id", "=", "custom")
      .orderBy("position")
      .execute();
    expect(models.map((model) => ({ ...model, is_default: Boolean(model.is_default) }))).toEqual([
      {
        id: "first",
        position: 0,
        is_default: true,
        default_thinking_level: "low",
      },
      {
        id: "second",
        position: 1,
        is_default: false,
        default_thinking_level: null,
      },
    ]);
  });

  test("adds branch_name to pre-existing task tables", async () => {
    await sql`
      CREATE TABLE tasks (
        id text PRIMARY KEY,
        repo_id text NOT NULL,
        change_path text NOT NULL,
        worktree_path text,
        status text NOT NULL,
        ready_at text,
        preferred_workflow text,
        base_branch text,
        preferred_provider text,
        retry_from_step text,
        resume_input text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);

    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);

    expect(columns.rows.some((column) => column.name === "branch_name")).toBe(true);
  });

  test("adds archived_at to pre-existing task tables", async () => {
    await sql`
      CREATE TABLE tasks (
        id text PRIMARY KEY,
        repo_id text NOT NULL,
        change_path text NOT NULL,
        worktree_path text,
        status text NOT NULL,
        ready_at text,
        preferred_workflow text,
        base_branch text,
        preferred_provider text,
        retry_from_step text,
        resume_input text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);

    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);

    expect(columns.rows.some((column) => column.name === "archived_at")).toBe(true);
  });

  test("allows linkage rows without a tasks table foreign key", async () => {
    await runMigrations(db);
    await db
      .insertInto("repos")
      .values({
        id: "repo-1",
        path: "/tmp/migrations-test-repo",
        name: "migrations-test-repo",
        remote_origin: null,
        max_concurrent_tasks: 1,
      })
      .execute();

    await db
      .insertInto("task_sources")
      .values({
        task_id: "task-1",
        repo_id: "repo-1",
        provider: "linear",
        external_id: "lin_123",
        external_ref: "ABC-123",
        external_url: "https://linear.app/acme/issue/ABC-123/first-issue",
        title_snapshot: "First issue",
      })
      .execute();
    await db
      .insertInto("task_dependencies")
      .values({
        task_id: "task-1",
        depends_on_task_id: "task-2",
        source: "linear_blocks",
      })
      .execute();

    expect(await db.selectFrom("task_sources").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("task_dependencies").selectAll().execute()).toHaveLength(1);
  });

  test("allows the same task dependency edge to be mirrored from multiple providers", async () => {
    await runMigrations(db);

    await db
      .insertInto("task_dependencies")
      .values([
        {
          task_id: "task-1",
          depends_on_task_id: "task-2",
          source: "linear_blocks",
        },
        {
          task_id: "task-1",
          depends_on_task_id: "task-2",
          source: "jira_blocks",
        },
      ])
      .execute();

    expect(await db.selectFrom("task_dependencies").selectAll().execute()).toHaveLength(2);
  });

  test("migrates task dependency edges created with the legacy two-column primary key", async () => {
    await sql`
      CREATE TABLE task_dependencies (
        task_id text NOT NULL,
        depends_on_task_id text NOT NULL,
        source text NOT NULL,
        created_at text NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT chk_task_dependencies_not_self CHECK (task_id <> depends_on_task_id),
        CONSTRAINT pk_task_dependencies PRIMARY KEY (task_id, depends_on_task_id)
      )
    `.execute(db);
    await db
      .insertInto("task_dependencies")
      .values({
        task_id: "task-1",
        depends_on_task_id: "task-2",
        source: "linear_blocks",
      })
      .execute();

    await runMigrations(db);

    await db
      .insertInto("task_dependencies")
      .values({
        task_id: "task-1",
        depends_on_task_id: "task-2",
        source: "jira_blocks",
      })
      .execute();

    const primaryKeyColumns = await sql<{ name: string; pk: number }>`
      PRAGMA table_info(task_dependencies)
    `.execute(db);

    expect(
      primaryKeyColumns.rows
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
    ).toEqual(["task_id", "depends_on_task_id", "source"]);
    expect(await db.selectFrom("task_dependencies").selectAll().execute()).toHaveLength(2);
  });

  test("creates agent-centric relational tables", async () => {
    await runMigrations(db);

    const tables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'agents',
          'agent_repo_memberships',
          'channels',
          'channel_memberships',
          'channel_messages',
          'task_assignments'
        )
    `.execute(db);

    expect(tables.rows.map((table) => table.name).sort()).toEqual([
      "agent_repo_memberships",
      "agents",
      "channel_memberships",
      "channel_messages",
      "channels",
      "task_assignments",
    ]);
  });

  test("persists agent, channel, and assignment rows with foreign keys", async () => {
    await runMigrations(db);

    await db
      .insertInto("workflows")
      .values({
        id: "workflow-1",
        name: "workflow-1",
        definition: "{}",
      })
      .execute();

    await db
      .insertInto("repos")
      .values({
        id: "repo-1",
        path: "/tmp/agent-foundation-repo",
        name: "agent-foundation-repo",
        remote_origin: null,
        max_concurrent_tasks: 1,
      })
      .execute();

    await db
      .insertInto("tasks")
      .values({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "docs/tasks/agent-foundation",
        worktree_path: null,
        status: "DRAFT",
        ready_at: null,
        preferred_workflow: null,
        base_branch: null,
        preferred_provider: null,
        retry_from_step: null,
        resume_input: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: "agent-1",
        name: "Agent One",
        role: "developer",
        runtime_provider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
        workflow_id: "workflow-1",
        status: "active",
        artifact_path: "/tmp/.aop/agents/agent-1",
        source_kind: "manual",
        source_ref: null,
      })
      .execute();

    await db
      .insertInto("agent_repo_memberships")
      .values({
        agent_id: "agent-1",
        repo_id: "repo-1",
        membership_role: "primary",
      })
      .execute();

    await db
      .insertInto("channels")
      .values({
        id: "chan-1",
        repo_id: null,
        owner_agent_id: "agent-1",
        kind: "private",
        name: "Agent One",
        artifact_path: "/tmp/.aop/agents/agent-1/chats/private/chan-1",
      })
      .execute();

    await db
      .insertInto("channel_memberships")
      .values({
        channel_id: "chan-1",
        agent_id: "agent-1",
      })
      .execute();

    await db
      .insertInto("channel_messages")
      .values({
        id: "cmsg-1",
        channel_id: "chan-1",
        author_type: "system",
        author_agent_id: null,
        content: "bootstrapped",
      })
      .execute();

    await db
      .insertInto("task_assignments")
      .values({
        id: "asgn-1",
        task_id: "task-1",
        agent_id: "agent-1",
        repo_id: "repo-1",
        status_column: "READY",
        is_current: true,
      })
      .execute();

    expect(await db.selectFrom("agents").select(["workflow_id"]).executeTakeFirstOrThrow()).toEqual(
      {
        workflow_id: "workflow-1",
      },
    );
    expect(
      await db.selectFrom("channels").select(["owner_agent_id"]).executeTakeFirstOrThrow(),
    ).toEqual({
      owner_agent_id: "agent-1",
    });
    expect(await db.selectFrom("task_assignments").selectAll().execute()).toHaveLength(1);
  });

  test("adds the auto_distribute_disabled column with default 0 and re-runs idempotently", async () => {
    await runMigrations(db);
    await runMigrations(db);

    const columns = await sql<{ name: string; dflt_value: string | null; notnull: number }>`
      PRAGMA table_info(agents)
    `.execute(db);

    const autoDistributeDisabled = columns.rows.find(
      (column) => column.name === "auto_distribute_disabled",
    );

    expect(autoDistributeDisabled).toBeDefined();
    expect(autoDistributeDisabled?.notnull).toBe(1);
    expect(autoDistributeDisabled?.dflt_value).toBe("0");
  });

  test("does not create legacy planning tables on a fresh install", async () => {
    await runMigrations(db);

    const planningTables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('planning_postits', 'planning_runs')
    `.execute(db);

    expect(planningTables.rows).toHaveLength(0);
  });

  test("drops retired intake tables", async () => {
    await runMigrations(db);

    await db
      .insertInto("repos")
      .values({
        id: "repo-1",
        path: "/tmp/legacy-planning-repo",
        name: "legacy-planning-repo",
        remote_origin: null,
        max_concurrent_tasks: 1,
      })
      .execute();

    await sql`
      CREATE TABLE planning_postits (
        id text PRIMARY KEY,
        repo_id text NOT NULL,
        description text NOT NULL,
        assigned_agent_id text,
        status text NOT NULL DEFAULT 'backlog',
        task_id text,
        error_message text,
        created_at text NOT NULL DEFAULT (datetime('now')),
        updated_at text NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE planning_runs (
        id text PRIMARY KEY,
        postit_id text NOT NULL REFERENCES planning_postits(id) ON DELETE CASCADE
      )
    `.execute(db);

    await runMigrations(db);

    const planningTables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('planning_postits', 'planning_runs')
    `.execute(db);

    expect(planningTables.rows).toHaveLength(0);
  });

  test("creates chat sessions, messages, and durable runs on fresh DB", async () => {
    await runMigrations(db);

    const tables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('chat_sessions', 'chat_messages', 'chat_runs')
    `.execute(db);

    expect(tables.rows.map((table) => table.name).sort()).toEqual([
      "chat_messages",
      "chat_runs",
      "chat_sessions",
    ]);

    const runCols = await sql<{ name: string }>`PRAGMA table_info(chat_runs)`.execute(db);
    expect(runCols.rows.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "session_id",
        "user_message_id",
        "assistant_message_id",
        "runtime",
        "log_file_path",
        "status",
        "failure_kind",
        "resume_session_id",
        "interruption_kind",
        "context_strategy",
        "workspace_path",
        "timeout_policy",
        "retry_of_run_id",
        "runtime_session_state",
      ]),
    );

    const sessionCols = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
    const names = sessionCols.rows.map((c) => c.name);
    expect(names).toContain("runtime_session_id");
    expect(names).toContain("runtime_alias");
    expect(names).toContain("pinned");
    expect(names).toContain("settled_override");
    expect(names).toContain("settled_at");
    expect(names).not.toContain("archived");
    expect(names).toContain("workspace_path");
    expect(names).toContain("runtime_access_mode");
  });

  test("adds settlement fields and backfills legacy archived sessions without rebuilding", async () => {
    await sql`
      CREATE TABLE chat_sessions (
        id text PRIMARY KEY,
        repo_id text,
        title text NOT NULL,
        named integer NOT NULL DEFAULT 0,
        runtime text NOT NULL,
        model text NOT NULL,
        reasoning_effort text NOT NULL,
        runtime_alias text,
        runtime_session_id text,
        pinned integer NOT NULL DEFAULT 0,
        archived integer NOT NULL DEFAULT 0,
        legacy_marker text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO chat_sessions (
        id, title, runtime, model, reasoning_effort, archived, legacy_marker, created_at, updated_at
      ) VALUES (
        'legacy-settled', 'Legacy', 'claude-code', 'claude', 'medium', 1, 'preserved',
        '2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z'
      )
    `.execute(db);

    await runMigrations(db);

    const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
    expect(columns.rows.map((column) => column.name)).toEqual(
      expect.arrayContaining(["archived", "legacy_marker", "settled_override", "settled_at"]),
    );
    const row = await sql<{
      settled_override: string | null;
      settled_at: string | null;
      legacy_marker: string | null;
    }>`
      SELECT settled_override, settled_at, legacy_marker
      FROM chat_sessions
      WHERE id = 'legacy-settled'
    `.execute(db);
    expect(row.rows[0]).toEqual({
      settled_override: "settled",
      settled_at: "2026-02-02T00:00:00.000Z",
      legacy_marker: "preserved",
    });
  });

  test("adds last_read_at on chat_sessions and re-runs idempotently", async () => {
    await runMigrations(db);
    await runMigrations(db);

    const columns = await sql<{ name: string; notnull: number }>`
      PRAGMA table_info(chat_sessions)
    `.execute(db);
    const lastReadAt = columns.rows.find((column) => column.name === "last_read_at");

    expect(lastReadAt).toBeDefined();
    expect(lastReadAt?.notnull).toBe(0);
  });

  test("adds failure_kind and resume_session_id to existing chat_runs tables", async () => {
    await sql`
      CREATE TABLE chat_sessions (
        id text PRIMARY KEY,
        repo_id text,
        title text NOT NULL,
        named integer NOT NULL DEFAULT 0,
        runtime text NOT NULL,
        model text NOT NULL,
        reasoning_effort text NOT NULL,
        runtime_alias text,
        runtime_session_id text,
        fast_mode integer NOT NULL DEFAULT 0,
        pinned integer NOT NULL DEFAULT 0,
        archived integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (datetime('now')),
        updated_at text NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(db);
    await sql`
      CREATE TABLE chat_messages (
        id text PRIMARY KEY,
        session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        action text,
        created_at text NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(db);
    await sql`
      CREATE TABLE chat_runs (
        id text PRIMARY KEY,
        session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        user_message_id text NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        assistant_message_id text NOT NULL,
        runtime text NOT NULL,
        log_file_path text NOT NULL,
        status text NOT NULL DEFAULT 'running',
        runtime_session_id text,
        error_message text,
        created_at text NOT NULL DEFAULT (datetime('now')),
        updated_at text NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(db);

    await runMigrations(db);

    const runCols = await sql<{ name: string }>`PRAGMA table_info(chat_runs)`.execute(db);
    const names = runCols.rows.map((column) => column.name);
    expect(names).toContain("failure_kind");
    expect(names).toContain("resume_session_id");
    expect(names).toEqual(
      expect.arrayContaining([
        "interruption_kind",
        "context_strategy",
        "workspace_path",
        "timeout_policy",
        "retry_of_run_id",
        "runtime_session_state",
      ]),
    );
  });

  test("keeps legacy context unknown and enforces direct-retry and run cardinality invariants", async () => {
    await runMigrations(db);
    await sql`
      INSERT INTO chat_sessions (
        id, title, runtime, model, reasoning_effort, created_at, updated_at
      ) VALUES (
        'session-continuity', 'Continuity', 'grok-build', 'grok-4.5', 'medium',
        '2026-01-01', '2026-01-01'
      )
    `.execute(db);
    for (const id of ["original", "retry-one", "retry-two"]) {
      await sql`
        INSERT INTO chat_messages (id, session_id, role, content, created_at)
        VALUES (${`message-${id}`}, 'session-continuity', 'user', ${id}, '2026-01-01')
      `.execute(db);
    }
    await sql`
      INSERT INTO chat_runs (
        id, session_id, user_message_id, assistant_message_id, runtime, log_file_path,
        status, created_at, updated_at
      ) VALUES (
        'run-original', 'session-continuity', 'message-original', 'assistant-original',
        'grok-build', '/tmp/original.jsonl', 'interrupted', '2026-01-01', '2026-01-01'
      )
    `.execute(db);
    await sql`
      INSERT INTO chat_runs (
        id, session_id, user_message_id, assistant_message_id, runtime, log_file_path,
        status, context_strategy, retry_of_run_id, created_at, updated_at
      ) VALUES (
        'run-retry-one', 'session-continuity', 'message-retry-one', 'assistant-retry-one',
        'grok-build', '/tmp/retry-one.jsonl', 'failed', 'aop_history', 'run-original',
        '2026-01-01', '2026-01-01'
      )
    `.execute(db);

    const original = await db
      .selectFrom("chat_runs")
      .select(["status", "context_strategy"])
      .where("id", "=", "run-original")
      .executeTakeFirstOrThrow();
    expect(original).toEqual({ status: "interrupted", context_strategy: null });
    await expect(
      sql`
      INSERT INTO chat_runs (
        id, session_id, user_message_id, assistant_message_id, runtime, log_file_path,
        status, context_strategy, retry_of_run_id, created_at, updated_at
      ) VALUES (
        'run-retry-two', 'session-continuity', 'message-retry-two', 'assistant-retry-two',
        'grok-build', '/tmp/retry-two.jsonl', 'running', 'aop_history', 'run-original',
        '2026-01-01', '2026-01-01'
      )
    `.execute(db),
    ).rejects.toThrow();
    await expect(
      sql`
      INSERT INTO chat_runs (
        id, session_id, user_message_id, assistant_message_id, runtime, log_file_path,
        status, context_strategy, created_at, updated_at
      ) VALUES (
        'run-duplicate-user', 'session-continuity', 'message-original', 'assistant-duplicate',
        'grok-build', '/tmp/duplicate.jsonl', 'failed', 'fresh', '2026-01-01', '2026-01-01'
      )
    `.execute(db),
    ).rejects.toThrow();
  });

  test("persists and reloads chat run failure_kind and resume_session_id", async () => {
    await runMigrations(db);

    await db
      .insertInto("chat_sessions")
      .values({
        id: "isess_failure_kind",
        repo_id: null,
        title: "failure kind",
        named: false,
        runtime: "codex-cli",
        runtime_configuration_id: null,
        model: "gpt-5.4",
        reasoning_effort: "medium",
        runtime_alias: null,
        runtime_session_id: "resume-bind-1",
        fast_mode: false,
        default_worker_id: null,
        default_workflow_id: null,
        pinned: false,
        settled_override: null,
        settled_at: null,
      })
      .execute();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_failure_user",
        session_id: "isess_failure_kind",
        role: "user",
        content: "hello",
        action: null,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_failure_kind",
        session_id: "isess_failure_kind",
        user_message_id: "smsg_failure_user",
        assistant_message_id: "smsg_failure_assistant",
        runtime: "codex-cli",
        log_file_path: "/tmp/crun_failure_kind.jsonl",
        status: "failed",
        runtime_session_id: "discovered-runtime-1",
        resume_session_id: "resume-bind-1",
        failure_kind: "empty_output",
        error_message: "no assistant text",
      })
      .execute();

    const loaded = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", "crun_failure_kind")
      .executeTakeFirstOrThrow();

    expect(loaded.failure_kind).toBe("empty_output");
    expect(loaded.resume_session_id).toBe("resume-bind-1");
    expect(loaded.runtime_session_id).toBe("discovered-runtime-1");

    await db
      .updateTable("chat_runs")
      .set({ failure_kind: null, error_message: "other error" })
      .where("id", "=", "crun_failure_kind")
      .execute();

    const unclassified = await db
      .selectFrom("chat_runs")
      .select(["failure_kind", "error_message"])
      .where("id", "=", "crun_failure_kind")
      .executeTakeFirstOrThrow();
    expect(unclassified.failure_kind).toBeNull();
    expect(unclassified.error_message).toBe("other error");
  });

  test("creates runtime profiles and fast-mode persistence", async () => {
    await runMigrations(db);

    const profileColumns = await sql<{ name: string }>`PRAGMA table_info(runtime_profiles)`.execute(
      db,
    );
    expect(profileColumns.rows.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "base_provider",
        "command",
        "model",
        "reasoning",
        "fast_mode",
        "created_at",
        "updated_at",
      ]),
    );

    const sessionColumns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(
      db,
    );
    expect(sessionColumns.rows.map((column) => column.name)).toContain("fast_mode");
    expect(sessionColumns.rows.map((column) => column.name)).not.toContain("browser_control");
    expect(sessionColumns.rows.map((column) => column.name)).not.toContain("computer_control");
    expect(
      await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", "fast_mode")
        .executeTakeFirst(),
    ).toEqual({
      value: "false",
    });

    await db
      .insertInto("runtime_profiles")
      .values({
        id: "rprof_1",
        name: "Work Codex",
        base_provider: "codex-cli",
        command: "cdx",
        model: "gpt-5.5",
        reasoning: "high",
        fast_mode: true,
      })
      .execute();
    await expect(
      db
        .insertInto("runtime_profiles")
        .values({
          id: "rprof_2",
          name: "work codex",
          base_provider: "codex-cli",
          command: "codex",
          model: "gpt-5.5",
          reasoning: "medium",
          fast_mode: false,
        })
        .execute(),
    ).rejects.toThrow();
  });

  test("creates chat history tables and bulk-query indexes", async () => {
    await runMigrations(db);

    const tables = await sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'chat_%'
    `.execute(db);
    expect(tables.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "chat_run_checkpoints",
        "chat_run_changed_files",
        "chat_run_events",
        "chat_revert_operations",
        "chat_checkpoint_cleanup_jobs",
      ]),
    );

    const indexes = await sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_chat_%'
    `.execute(db);
    expect(indexes.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "idx_chat_run_events_replay",
        "idx_chat_run_events_run_sequence",
        "idx_chat_revert_operations_session_status",
        "idx_chat_revert_operations_cleanup",
        "idx_chat_checkpoint_cleanup_jobs_status",
        "idx_chat_checkpoint_cleanup_jobs_claim",
      ]),
    );

    for (const [index, columns] of Object.entries(CHAT_HISTORY_INDEX_COLUMNS)) {
      expect(await indexColumns(db, index), index).toEqual(columns);
    }
  });

  test("creates cleanup claim state and keeps the revert contract three-state", async () => {
    await runMigrations(db);

    const columns = await sql<{ name: string; notnull: number; dflt_value: string | null }>`
      PRAGMA table_info(chat_checkpoint_cleanup_jobs)
    `.execute(db);
    const byName = new Map(columns.rows.map((column) => [column.name, column]));
    expect(byName.get("session_ids_json")?.notnull).toBe(1);
    expect(byName.get("session_ids_json")?.dflt_value).toBe("'[]'");
    expect(byName.get("claim_token")?.notnull).toBe(0);
    expect(byName.get("claimed_at")?.notnull).toBe(0);
    expect(byName.get("attempts")?.dflt_value).toBe("0");

    const revertColumns = await sql<{ name: string; dflt_value: string | null }>`
      PRAGMA table_info(chat_revert_operations)
    `.execute(db);
    const cleanupStatus = revertColumns.rows.find((column) => column.name === "cleanup_status");
    expect(cleanupStatus?.dflt_value).toBe("'pending'");
  });

  test("represents detached HEAD and unborn repositories without placeholder values", async () => {
    await runMigrations(db);
    await seedCheckpointSession(db);

    await db
      .insertInto("chat_run_checkpoints")
      .values([
        checkpointRow("run-detached", { branch: null, head_oid: "abc123" }),
        checkpointRow("run-unborn", { branch: "main", head_oid: null }),
      ])
      .execute();

    const rows = await db
      .selectFrom("chat_run_checkpoints")
      .selectAll()
      .orderBy("run_id")
      .execute();
    expect(rows.map((row) => [row.run_id, row.branch, row.head_oid])).toEqual([
      ["run-detached", null, "abc123"],
      ["run-unborn", "main", null],
    ]);
  });

  test("upgrades a pre-feature database and preserves every existing chat row", async () => {
    await createPreFeatureChatSchema(db);
    await sql`
      INSERT INTO chat_sessions (id, title, runtime, model, reasoning_effort)
      VALUES ('legacy-session', 'Legacy', 'claude-code', 'claude', 'medium')
    `.execute(db);
    await sql`
      INSERT INTO chat_messages (id, session_id, role, content)
      VALUES ('legacy-user', 'legacy-session', 'user', 'hello'),
             ('legacy-assistant', 'legacy-session', 'assistant', 'hi')
    `.execute(db);
    await sql`
      INSERT INTO chat_runs (id, session_id, user_message_id, assistant_message_id, runtime, log_file_path)
      VALUES ('legacy-run', 'legacy-session', 'legacy-user', 'legacy-assistant', 'claude-code', '/tmp/legacy.jsonl')
    `.execute(db);

    await runMigrations(db);

    expect(await db.selectFrom("chat_sessions").select("id").execute()).toEqual([
      { id: "legacy-session" },
    ]);
    expect(
      (await db.selectFrom("chat_messages").select("id").orderBy("id").execute()).map(
        (row) => row.id,
      ),
    ).toEqual(["legacy-assistant", "legacy-user"]);
    expect(await db.selectFrom("chat_runs").select("id").execute()).toEqual([{ id: "legacy-run" }]);

    const tables = await sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chat_%'
    `.execute(db);
    expect(tables.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "chat_run_checkpoints",
        "chat_run_changed_files",
        "chat_run_events",
        "chat_revert_operations",
        "chat_checkpoint_cleanup_jobs",
      ]),
    );
    for (const [index, columns] of Object.entries(CHAT_HISTORY_INDEX_COLUMNS)) {
      expect(await indexColumns(db, index), index).toEqual(columns);
    }
  });

  test("upgrades a database created by the partial foundation schema", async () => {
    await runMigrations(db);
    await seedCheckpointSession(db);
    await createPartialFoundationSchema(db);

    // Rows written before the repair, under the old NOT NULL and no-claim shape.
    await sql`
      INSERT INTO chat_run_checkpoints (
        run_id, workspace_path, worktree_root, git_common_dir, branch, head_oid,
        before_ref, after_ref, before_status, after_status
      ) VALUES (
        'run-partial', '/workspace', '/workspace', '/repo/.git', 'main', 'head-oid',
        'refs/aop/chat-checkpoints/csess_1/run-partial/before',
        'refs/aop/chat-checkpoints/csess_1/run-partial/after',
        'ready', 'ready'
      )
    `.execute(db);
    await sql`
      INSERT INTO chat_checkpoint_cleanup_jobs (
        id, workspace_path, worktree_root, git_common_dir, refs_json, status
      ) VALUES (
        'cleanup-partial', '/workspace', '/workspace', '/repo/.git',
        '["refs/aop/chat-checkpoints/csess_1/run-partial/before"]', 'pending'
      )
    `.execute(db);

    await runMigrations(db);

    const checkpointColumns = await sql<{ name: string; notnull: number }>`
      PRAGMA table_info(chat_run_checkpoints)
    `.execute(db);
    const byName = new Map(checkpointColumns.rows.map((column) => [column.name, column]));
    expect(byName.get("branch")?.notnull).toBe(0);
    expect(byName.get("head_oid")?.notnull).toBe(0);
    expect(byName.get("workspace_path")?.notnull).toBe(1);

    expect(await db.selectFrom("chat_run_checkpoints").selectAll().execute()).toMatchObject([
      { run_id: "run-partial", branch: "main", head_oid: "head-oid", before_status: "ready" },
    ]);
    expect(await indexColumns(db, "idx_chat_run_checkpoints_workspace")).toEqual([
      "workspace_path",
    ]);

    const job = await db
      .selectFrom("chat_checkpoint_cleanup_jobs")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(job).toMatchObject({
      id: "cleanup-partial",
      status: "pending",
      session_ids_json: "[]",
      claim_token: null,
      claimed_at: null,
      attempts: 0,
    });

    // The repaired table now accepts detached-HEAD and unborn-repo rows.
    await db
      .insertInto("chat_run_checkpoints")
      .values(checkpointRow("run-detached", { branch: null, head_oid: null }))
      .execute();
    expect(
      await db
        .selectFrom("chat_run_checkpoints")
        .select(["branch", "head_oid"])
        .where("run_id", "=", "run-detached")
        .executeTakeFirst(),
    ).toEqual({ branch: null, head_oid: null });
  });

  test("runs chat history migrations twice without changing existing rows", async () => {
    await runMigrations(db);
    await db
      .insertInto("chat_checkpoint_cleanup_jobs")
      .values({
        id: "cleanup-1",
        workspace_path: "/tmp/workspace",
        worktree_root: "/tmp/workspace",
        git_common_dir: "/tmp/workspace/.git",
        refs_json: '["refs/aop/chat-checkpoints/csess_1/crun_1/before"]',
        session_ids_json: '["csess_1"]',
        status: "processing",
        error_message: null,
        claim_token: "worker-a",
        claimed_at: "2026-07-24T10:00:00.000Z",
        attempts: 2,
        completed_at: null,
      })
      .execute();

    await runMigrations(db);

    expect(await db.selectFrom("chat_checkpoint_cleanup_jobs").selectAll().execute()).toMatchObject(
      [
        {
          id: "cleanup-1",
          status: "processing",
          claim_token: "worker-a",
          attempts: 2,
          session_ids_json: '["csess_1"]',
        },
      ],
    );
  });
});

/** Exact indexed-column order, asserted with PRAGMA index_info. */
const CHAT_HISTORY_INDEX_COLUMNS: Record<string, string[]> = {
  idx_chat_run_events_replay: ["run_id", "source_kind", "source_index", "source_subindex"],
  idx_chat_run_events_run_sequence: ["run_id", "sequence"],
  idx_chat_revert_operations_session_status: ["session_id", "status"],
  idx_chat_revert_operations_cleanup: ["cleanup_status", "created_at"],
  idx_chat_checkpoint_cleanup_jobs_status: ["status", "created_at"],
  idx_chat_checkpoint_cleanup_jobs_claim: ["status", "claimed_at"],
};

const indexColumns = async (db: Kysely<Database>, index: string): Promise<string[]> => {
  const info = await sql<{ seqno: number; name: string }>`
    SELECT seqno, name FROM pragma_index_info(${index})
  `.execute(db);
  return [...info.rows].sort((left, right) => left.seqno - right.seqno).map((row) => row.name);
};

const checkpointRow = (
  runId: string,
  overrides: { branch: string | null; head_oid: string | null },
) => ({
  run_id: runId,
  workspace_path: "/workspace",
  worktree_root: "/workspace",
  git_common_dir: "/repo/.git",
  before_ref: `refs/aop/chat-checkpoints/csess_1/${runId}/before`,
  after_ref: `refs/aop/chat-checkpoints/csess_1/${runId}/after`,
  before_oid: null,
  after_oid: null,
  before_status: "pending" as const,
  after_status: "pending" as const,
  before_error: null,
  after_error: null,
  ...overrides,
});

/** Minimal session/message/run rows so checkpoint inserts have a plausible parent. */
const seedCheckpointSession = async (db: Kysely<Database>): Promise<void> => {
  await sql`
    INSERT INTO chat_sessions (id, title, runtime, model, reasoning_effort)
    VALUES ('csess_1', 'Checkpoints', 'claude-code', 'claude', 'medium')
  `.execute(db);
};

/** A database from before the chat-history feature: sessions, messages, runs only. */
const createPreFeatureChatSchema = async (db: Kysely<Database>): Promise<void> => {
  await sql`
    CREATE TABLE chat_sessions (
      id text PRIMARY KEY,
      repo_id text,
      title text NOT NULL,
      named integer NOT NULL DEFAULT 0,
      runtime text NOT NULL,
      model text NOT NULL,
      reasoning_effort text NOT NULL,
      runtime_alias text,
      runtime_session_id text,
      fast_mode integer NOT NULL DEFAULT 0,
      pinned integer NOT NULL DEFAULT 0,
      archived integer NOT NULL DEFAULT 0,
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
  await sql`
    CREATE TABLE chat_messages (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      action text,
      created_at text NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
  await sql`
    CREATE TABLE chat_runs (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      user_message_id text NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      assistant_message_id text NOT NULL,
      runtime text NOT NULL,
      log_file_path text NOT NULL,
      status text NOT NULL DEFAULT 'running',
      runtime_session_id text,
      error_message text,
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
};

/**
 * The shape the first foundation cut produced: NOT NULL checkpoint audit
 * columns and cleanup jobs with no claim state.
 */
const createPartialFoundationSchema = async (db: Kysely<Database>): Promise<void> => {
  await sql`DROP TABLE chat_run_checkpoints`.execute(db);
  await sql`DROP TABLE chat_checkpoint_cleanup_jobs`.execute(db);
  await sql`
    CREATE TABLE chat_run_checkpoints (
      run_id text PRIMARY KEY REFERENCES chat_runs(id) ON DELETE CASCADE,
      workspace_path text NOT NULL,
      worktree_root text NOT NULL,
      git_common_dir text NOT NULL,
      branch text NOT NULL,
      head_oid text NOT NULL,
      before_ref text NOT NULL,
      after_ref text NOT NULL,
      before_oid text,
      after_oid text,
      before_status text NOT NULL DEFAULT 'pending',
      after_status text NOT NULL DEFAULT 'pending',
      before_error text,
      after_error text,
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
  await sql`
    CREATE INDEX idx_chat_run_checkpoints_workspace ON chat_run_checkpoints (workspace_path)
  `.execute(db);
  await sql`
    CREATE TABLE chat_checkpoint_cleanup_jobs (
      id text PRIMARY KEY,
      workspace_path text NOT NULL,
      worktree_root text NOT NULL,
      git_common_dir text NOT NULL,
      refs_json text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      error_message text,
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now')),
      completed_at text
    )
  `.execute(db);
  await sql`
    CREATE INDEX idx_chat_checkpoint_cleanup_jobs_status
    ON chat_checkpoint_cleanup_jobs (status, created_at)
  `.execute(db);
};
