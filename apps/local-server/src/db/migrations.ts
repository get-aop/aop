import type { Kysely } from "kysely";
import { sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import { runChatHistoryMigrations } from "./chat-history-migrations.ts";
import type { Database } from "./schema.ts";

export const runMigrations = async (db: Kysely<Database>): Promise<void> => {
  await createSettingsTable(db);
  await insertDefaultSettings(db);
  await createRuntimeProfilesTable(db);
  await ensureRuntimeProfileExecHostIdColumn(db);
  await createRuntimeConfigurationTables(db);
  await ensureRuntimeConfigurationModelPreferenceColumns(db);
  await ensureRuntimeConfigurationModelDefaultThinkingColumn(db);
  await ensureRuntimeConfigurationProviderPositionColumn(db);
  await ensureRuntimeConfigurationProviderSupportsFastModeColumn(db);
  await dropRetiredClaudeEndpointOverrideColumns(db);
  await createWorkflowsTable(db);
  await createWorkflowSkillBlocksTable(db);
  await createReposTable(db);
  await createTasksTable(db);
  await ensureTaskBranchNameColumn(db);
  await ensureTaskArchivedAtColumn(db);
  await ensureTaskHandoffPendingApprovalColumn(db);
  await ensureTaskHandoffRequiresApprovalOverrideColumn(db);
  await ensureTaskOriginChatSessionIdColumn(db);
  await createAgentsTable(db);
  await ensureAgentBoardColumns(db);
  await createAgentRepoMembershipsTable(db);
  await createChannelsTable(db);
  await createChannelMembershipsTable(db);
  await createChannelMessagesTable(db);
  await createChatSessionsTable(db);
  await ensureChatSessionRuntimeConfigurationIdColumn(db);
  await ensureChatSessionFastModeColumn(db);
  await ensureChatSessionRuntimeAccessModeColumn(db);
  await ensureChatSessionControlColumns(db);
  await ensureChatSessionContextChipColumns(db);
  await ensureChatSessionWorkspaceColumn(db);
  await ensureChatSessionLastReadAtColumn(db);
  await ensureChatSessionNullableRepoId(db);
  await ensureChatSessionSettlementColumns(db);
  await dropRetiredChatSessionControlColumns(db);
  await createChatMessagesTable(db);
  await ensureChatMessageActivityColumn(db);
  await ensureChatMessageContinuityColumns(db);
  await repairTaskStatusNoteTurnIndexes(db);
  await createChatRunsTable(db);
  await ensureChatRunFailureColumns(db);
  await ensureChatRunContinuityColumns(db);
  await ensureChatRunDelegationColumn(db);
  await runChatHistoryMigrations(db);
  await createWorkflowRunsTable(db);
  await createTaskAssignmentsTable(db);
  await createTaskSourcesTable(db);
  await createTaskDependenciesTable(db);
  await createExecutionsTable(db);
  await createStepExecutionsTable(db);
  await createStepUsageTable(db);
  await createStepLogsTable(db);
  await createRuntimeEventsTable(db);
  await dropLegacySessionTables(db);
  await dropRetiredIntakeTables(db);
  await dropRetiredLicenseSettings(db);
  await createSchedulerTriggersTable(db);
  await createSignalsTable(db);
};

const repairTaskStatusNoteTurnIndexes = async (db: Kysely<Database>): Promise<void> => {
  const notes = await db
    .selectFrom("chat_messages")
    .select(["id", "session_id"])
    .where("role", "=", "assistant")
    .where("turn_index", "=", 0)
    .where((eb) =>
      eb.and([
        eb("action", "like", '%"type":"task"%'),
        eb.or([
          eb("action", "like", '%"label":"Task done"%'),
          eb("action", "like", '%"label":"Task blocked"%'),
        ]),
      ]),
    )
    .orderBy("session_id")
    .orderBy("created_at")
    .orderBy("id")
    .execute();

  const nextBySession = new Map<string, number>();
  for (const note of notes) {
    let next = nextBySession.get(note.session_id);
    if (next === undefined) {
      const maximum = await db
        .selectFrom("chat_messages")
        .select((eb) => eb.fn.max<number>("turn_index").as("maximum"))
        .where("session_id", "=", note.session_id)
        .executeTakeFirst();
      next = (maximum?.maximum ?? 0) + 1;
    }
    await db
      .updateTable("chat_messages")
      .set({ turn_index: next })
      .where("id", "=", note.id)
      .execute();
    nextBySession.set(note.session_id, next + 1);
  }
};

const createSettingsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("settings")
    .ifNotExists()
    .addColumn("key", "text", (col) => col.primaryKey())
    .addColumn("value", "text", (col) => col.notNull())
    .execute();
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

const createRuntimeProfilesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("runtime_profiles")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("base_provider", "text", (col) => col.notNull())
    .addColumn("command", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("reasoning", "text", (col) => col.notNull())
    .addColumn("fast_mode", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("exec_host_id", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_profiles_name_nocase
    ON runtime_profiles(name COLLATE NOCASE)
  `.execute(db);
};

const ensureRuntimeProfileExecHostIdColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_profiles)`.execute(db);
  if (columns.rows.some((column) => column.name === "exec_host_id")) return;
  await sql`ALTER TABLE runtime_profiles ADD COLUMN exec_host_id text`.execute(db);
};

const createRuntimeConfigurationTables = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("runtime_configuration_providers")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("command", "text", (col) => col.notNull())
    .addColumn("driver", "text", (col) => col.notNull())
    .addColumn("built_in", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("position", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("supports_fast_mode", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
  await db.schema
    .createTable("runtime_configuration_models")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("provider_id", "text", (col) =>
      col.notNull().references("runtime_configuration_providers.id").onDelete("cascade"),
    )
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("thinking_levels", "text", (col) => col.notNull())
    .addColumn("fast_mode", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("built_in", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_configuration_provider_name_nocase
    ON runtime_configuration_providers(name COLLATE NOCASE)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_configuration_model_provider_name
    ON runtime_configuration_models(provider_id, model)
  `.execute(db);
};

const ensureRuntimeConfigurationModelPreferenceColumns = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_models)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  const addedPosition = !names.has("position");
  const addedDefault = !names.has("is_default");

  if (addedPosition) {
    await sql`ALTER TABLE runtime_configuration_models ADD COLUMN position integer NOT NULL DEFAULT 0`.execute(
      db,
    );
    await sql`
      UPDATE runtime_configuration_models AS model
      SET position = (
        SELECT COUNT(*) - 1
        FROM runtime_configuration_models AS earlier
        WHERE earlier.provider_id = model.provider_id
          AND (earlier.created_at < model.created_at
            OR (earlier.created_at = model.created_at AND earlier.id <= model.id))
      )
    `.execute(db);
  }
  if (addedDefault) {
    await sql`ALTER TABLE runtime_configuration_models ADD COLUMN is_default integer NOT NULL DEFAULT 0`.execute(
      db,
    );
    await sql`
      UPDATE runtime_configuration_models
      SET is_default = 1
      WHERE position = 0
    `.execute(db);
  }
};

const ensureRuntimeConfigurationModelDefaultThinkingColumn = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_models)`.execute(db);
  if (columns.rows.some((column) => column.name === "default_thinking_level")) return;

  await sql`ALTER TABLE runtime_configuration_models ADD COLUMN default_thinking_level text`.execute(
    db,
  );
  // Seed default thinking from the first configured level when present.
  await sql`
    UPDATE runtime_configuration_models
    SET default_thinking_level = CASE
      WHEN json_array_length(thinking_levels) > 0
        THEN json_extract(thinking_levels, '$[0]')
      ELSE NULL
    END
    WHERE default_thinking_level IS NULL
  `.execute(db);
};

const ensureRuntimeConfigurationProviderPositionColumn = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_providers)`.execute(db);
  if (columns.rows.some((column) => column.name === "position")) return;

  await sql`ALTER TABLE runtime_configuration_providers ADD COLUMN position integer NOT NULL DEFAULT 0`.execute(
    db,
  );
  await sql`
    UPDATE runtime_configuration_providers AS provider
    SET position = (
      SELECT COUNT(*) - 1
      FROM runtime_configuration_providers AS earlier
      WHERE earlier.built_in > provider.built_in
        OR (earlier.built_in = provider.built_in
          AND (earlier.name COLLATE NOCASE < provider.name COLLATE NOCASE
            OR (earlier.name COLLATE NOCASE = provider.name COLLATE NOCASE
              AND earlier.id <= provider.id)))
    )
  `.execute(db);
};

const ensureRuntimeConfigurationProviderSupportsFastModeColumn = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_providers)`.execute(db);
  if (columns.rows.some((column) => column.name === "supports_fast_mode")) return;

  await sql`ALTER TABLE runtime_configuration_providers ADD COLUMN supports_fast_mode integer NOT NULL DEFAULT 0`.execute(
    db,
  );
  // Promote legacy per-model has-fast flags to the runtime (provider) level.
  await sql`
    UPDATE runtime_configuration_providers AS provider
    SET supports_fast_mode = 1
    WHERE EXISTS (
      SELECT 1
      FROM runtime_configuration_models AS model
      WHERE model.provider_id = provider.id
        AND model.fast_mode = 1
    )
    OR provider.driver IN ('codex-cli', 'pi')
  `.execute(db);
};

const dropRetiredClaudeEndpointOverrideColumns = async (db: Kysely<Database>): Promise<void> => {
  const providerColumns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_providers)`.execute(db);
  const providerNames = new Set(providerColumns.rows.map((column) => column.name));
  if (providerNames.has("endpoint_override_enabled")) {
    await sql`ALTER TABLE runtime_configuration_providers DROP COLUMN endpoint_override_enabled`.execute(
      db,
    );
  }
  if (providerNames.has("endpoint_kind")) {
    await sql`ALTER TABLE runtime_configuration_providers DROP COLUMN endpoint_kind`.execute(db);
  }
  if (providerNames.has("endpoint_token")) {
    await sql`ALTER TABLE runtime_configuration_providers DROP COLUMN endpoint_token`.execute(db);
  }
  if (providerNames.has("endpoint_url")) {
    await sql`ALTER TABLE runtime_configuration_providers DROP COLUMN endpoint_url`.execute(db);
  }

  const modelColumns = await sql<{
    name: string;
  }>`PRAGMA table_info(runtime_configuration_models)`.execute(db);
  if (modelColumns.rows.some((column) => column.name === "compact_context_window")) {
    await sql`ALTER TABLE runtime_configuration_models DROP COLUMN compact_context_window`.execute(
      db,
    );
  }
};

const createWorkflowsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("workflows")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("definition", "text", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull().defaultTo("user"))
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await ensureWorkflowSourceColumn(db);

  await db.schema
    .createIndex("idx_workflows_name")
    .ifNotExists()
    .on("workflows")
    .column("name")
    .execute();

  await db.schema
    .createIndex("idx_workflows_active")
    .ifNotExists()
    .on("workflows")
    .column("active")
    .execute();
};

const ensureWorkflowSourceColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(workflows)`.execute(db);
  if (columns.rows.some((column) => column.name === "source")) {
    return;
  }

  await sql`ALTER TABLE workflows ADD COLUMN source text NOT NULL DEFAULT 'builtin'`.execute(db);
};

const createWorkflowSkillBlocksTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("workflow_skill_blocks")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("category", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("signals", "text", (col) => col.notNull())
    .addColumn("prompt_template", "text", (col) => col.notNull())
    .addColumn("defaults", "text", (col) => col.notNull())
    .addColumn("agent", "text")
    .addColumn("source", "text", (col) => col.notNull().defaultTo("user"))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_workflow_skill_blocks_category")
    .ifNotExists()
    .on("workflow_skill_blocks")
    .column("category")
    .execute();
};

const createReposTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("repos")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("name", "text")
    .addColumn("remote_origin", "text")
    .addColumn("max_concurrent_tasks", "integer", (col) => col.defaultTo(3))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
};

const createTasksTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("tasks")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("change_path", "text", (col) => col.notNull())
    .addColumn("branch_name", "text")
    .addColumn("worktree_path", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("ready_at", "text")
    .addColumn("preferred_workflow", "text")
    .addColumn("base_branch", "text")
    .addColumn("preferred_provider", "text")
    .addColumn("retry_from_step", "text")
    .addColumn("resume_input", "text")
    .addColumn("archived_at", "text")
    .addColumn("handoff_pending_approval", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("handoff_requires_approval_override", "integer")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_tasks_repo_change_path")
    .ifNotExists()
    .on("tasks")
    .columns(["repo_id", "change_path"])
    .unique()
    .execute();
};

const ensureChatSessionNullableRepoId = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{
    name: string;
    notnull: number;
  }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.find((column) => column.name === "repo_id")?.notnull === 0) return;

  await sql`
    CREATE TABLE chat_sessions_next (
      id text PRIMARY KEY,
      repo_id text REFERENCES repos(id) ON DELETE CASCADE,
      title text NOT NULL,
      named integer NOT NULL DEFAULT 0,
      runtime text NOT NULL,
      runtime_configuration_id text,
      model text NOT NULL,
      reasoning_effort text NOT NULL,
      runtime_alias text,
      runtime_session_id text,
      fast_mode integer NOT NULL DEFAULT 0,
      runtime_access_mode text NOT NULL DEFAULT 'full-access',
      browser_control integer NOT NULL DEFAULT 0,
      computer_control integer NOT NULL DEFAULT 0,
      default_worker_id text,
      default_workflow_id text,
      pinned integer NOT NULL DEFAULT 0,
      archived integer NOT NULL DEFAULT 0,
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
  await sql`
    INSERT INTO chat_sessions_next (
      id, repo_id, title, named, runtime, runtime_configuration_id, model,
      reasoning_effort, runtime_alias, runtime_session_id, fast_mode, runtime_access_mode,
      browser_control, computer_control, default_worker_id, default_workflow_id,
      pinned, archived, created_at, updated_at
    )
    SELECT
      id, repo_id, title, named, runtime, runtime_configuration_id, model,
      reasoning_effort, runtime_alias, runtime_session_id, fast_mode, runtime_access_mode,
      browser_control, computer_control, default_worker_id, default_workflow_id,
      pinned, archived, created_at, updated_at
    FROM chat_sessions
  `.execute(db);
  await sql`DROP TABLE chat_sessions`.execute(db);
  await sql`ALTER TABLE chat_sessions_next RENAME TO chat_sessions`.execute(db);
  await db.schema
    .createIndex("idx_chat_sessions_repo")
    .ifNotExists()
    .on("chat_sessions")
    .column("repo_id")
    .execute();
  await db.schema
    .createIndex("idx_chat_sessions_updated")
    .ifNotExists()
    .on("chat_sessions")
    .column("updated_at")
    .execute();
};

const ensureTaskBranchNameColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  if (columns.rows.some((column) => column.name === "branch_name")) {
    return;
  }

  await sql`ALTER TABLE tasks ADD COLUMN branch_name text`.execute(db);
};

const ensureTaskArchivedAtColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  if (columns.rows.some((column) => column.name === "archived_at")) {
    return;
  }

  await sql`ALTER TABLE tasks ADD COLUMN archived_at text`.execute(db);
};

const ensureTaskHandoffPendingApprovalColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  if (columns.rows.some((column) => column.name === "handoff_pending_approval")) {
    return;
  }

  await sql`ALTER TABLE tasks ADD COLUMN handoff_pending_approval integer NOT NULL DEFAULT 0`.execute(
    db,
  );
};

const ensureTaskHandoffRequiresApprovalOverrideColumn = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  if (columns.rows.some((column) => column.name === "handoff_requires_approval_override")) {
    return;
  }

  await sql`ALTER TABLE tasks ADD COLUMN handoff_requires_approval_override integer`.execute(db);
};

const ensureTaskOriginChatSessionIdColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  if (columns.rows.some((column) => column.name === "origin_chat_session_id")) {
    return;
  }

  await sql`ALTER TABLE tasks ADD COLUMN origin_chat_session_id text`.execute(db);
  await db.schema
    .createIndex("idx_tasks_origin_chat_session_id")
    .ifNotExists()
    .on("tasks")
    .column("origin_chat_session_id")
    .execute();
};

const createAgentsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("agents")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("runtime_provider", "text", (col) => col.notNull())
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("workflow_id", "text", (col) =>
      col.notNull().references("workflows.id").onDelete("restrict"),
    )
    .addColumn("status", "text", (col) => col.notNull().defaultTo("active"))
    .addColumn("artifact_path", "text", (col) => col.notNull())
    .addColumn("source_kind", "text", (col) => col.notNull())
    .addColumn("source_ref", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_agents_status")
    .ifNotExists()
    .on("agents")
    .column("status")
    .execute();
};

const ensureAgentBoardColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(agents)`.execute(db);
  const existing = new Set(columns.rows.map((column) => column.name));

  if (!existing.has("auto_distribute_disabled")) {
    await sql`ALTER TABLE agents ADD COLUMN auto_distribute_disabled integer NOT NULL DEFAULT 0`.execute(
      db,
    );
  }
  if (!existing.has("focus")) {
    await sql`ALTER TABLE agents ADD COLUMN focus text`.execute(db);
  }
};

const createAgentRepoMembershipsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("agent_repo_memberships")
    .ifNotExists()
    .addColumn("agent_id", "text", (col) =>
      col.notNull().references("agents.id").onDelete("cascade"),
    )
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("membership_role", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addPrimaryKeyConstraint("pk_agent_repo_memberships", ["agent_id", "repo_id"])
    .execute();

  await db.schema
    .createIndex("idx_agent_repo_memberships_repo")
    .ifNotExists()
    .on("agent_repo_memberships")
    .column("repo_id")
    .execute();
};

const createChannelsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("channels")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.references("repos.id").onDelete("cascade"))
    .addColumn("owner_agent_id", "text", (col) => col.references("agents.id").onDelete("cascade"))
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("artifact_path", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_channels_repo_kind")
    .ifNotExists()
    .on("channels")
    .columns(["repo_id", "kind"])
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_private_owner
    ON channels(owner_agent_id)
    WHERE kind = 'private' AND owner_agent_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_factory_group
    ON channels(kind, name)
    WHERE kind = 'group' AND repo_id IS NULL
  `.execute(db);
};

const createChannelMembershipsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("channel_memberships")
    .ifNotExists()
    .addColumn("channel_id", "text", (col) =>
      col.notNull().references("channels.id").onDelete("cascade"),
    )
    .addColumn("agent_id", "text", (col) =>
      col.notNull().references("agents.id").onDelete("cascade"),
    )
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addPrimaryKeyConstraint("pk_channel_memberships", ["channel_id", "agent_id"])
    .execute();

  await db.schema
    .createIndex("idx_channel_memberships_agent")
    .ifNotExists()
    .on("channel_memberships")
    .column("agent_id")
    .execute();
};

const createChannelMessagesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("channel_messages")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("channel_id", "text", (col) =>
      col.notNull().references("channels.id").onDelete("cascade"),
    )
    .addColumn("author_type", "text", (col) => col.notNull())
    .addColumn("author_agent_id", "text", (col) => col.references("agents.id").onDelete("set null"))
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_channel_messages_channel")
    .ifNotExists()
    .on("channel_messages")
    .column("channel_id")
    .execute();
};

const createChatSessionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_sessions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.references("repos.id").onDelete("cascade"))
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("named", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("runtime", "text", (col) => col.notNull())
    .addColumn("runtime_configuration_id", "text")
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("reasoning_effort", "text", (col) => col.notNull())
    .addColumn("runtime_alias", "text")
    .addColumn("runtime_session_id", "text")
    .addColumn("workspace_path", "text")
    .addColumn("runtime_access_mode", "text", (col) => col.notNull().defaultTo("full-access"))
    .addColumn("browser_control", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("computer_control", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("default_worker_id", "text")
    .addColumn("default_workflow_id", "text")
    .addColumn("pinned", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("settled_override", "text")
    .addColumn("settled_at", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_chat_sessions_repo")
    .ifNotExists()
    .on("chat_sessions")
    .column("repo_id")
    .execute();

  await db.schema
    .createIndex("idx_chat_sessions_updated")
    .ifNotExists()
    .on("chat_sessions")
    .column("updated_at")
    .execute();
};

const ensureChatSessionRuntimeConfigurationIdColumn = async (
  db: Kysely<Database>,
): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.some((column) => column.name === "runtime_configuration_id")) return;
  await sql`ALTER TABLE chat_sessions ADD COLUMN runtime_configuration_id text`.execute(db);
};

const createChatMessagesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_messages")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("session_id", "text", (col) =>
      col.notNull().references("chat_sessions.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("action", "text")
    .addColumn("activity", "text")
    .addColumn("turn_index", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("disposition", "text", (col) => col.notNull().defaultTo("immediate"))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_chat_messages_session")
    .ifNotExists()
    .on("chat_messages")
    .column("session_id")
    .execute();
};

const ensureChatMessageActivityColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_messages)`.execute(db);
  if (columns.rows.some((column) => column.name === "activity")) return;
  await sql`ALTER TABLE chat_messages ADD COLUMN activity text`.execute(db);
};

const ensureChatMessageContinuityColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_messages)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  if (!names.has("turn_index")) {
    await sql`ALTER TABLE chat_messages ADD COLUMN turn_index integer NOT NULL DEFAULT 0`.execute(
      db,
    );
    await sql`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) AS position
        FROM chat_messages
      )
      UPDATE chat_messages
      SET turn_index = (SELECT position FROM ordered WHERE ordered.id = chat_messages.id)
    `.execute(db);
  }
  if (!names.has("disposition")) {
    await sql`ALTER TABLE chat_messages ADD COLUMN disposition text NOT NULL DEFAULT 'immediate'`.execute(
      db,
    );
  }
};

const ensureChatSessionFastModeColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.some((column) => column.name === "fast_mode")) return;

  await sql`ALTER TABLE chat_sessions ADD COLUMN fast_mode integer NOT NULL DEFAULT 0`.execute(db);
};

const ensureChatSessionRuntimeAccessModeColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.some((column) => column.name === "runtime_access_mode")) return;

  await sql`ALTER TABLE chat_sessions ADD COLUMN runtime_access_mode text NOT NULL DEFAULT 'full-access'`.execute(
    db,
  );
};

const ensureChatSessionControlColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (!columns.rows.some((column) => column.name === "browser_control")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN browser_control integer NOT NULL DEFAULT 0`.execute(
      db,
    );
  }
  if (!columns.rows.some((column) => column.name === "computer_control")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN computer_control integer NOT NULL DEFAULT 0`.execute(
      db,
    );
  }
};

const dropRetiredChatSessionControlColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  if (names.has("browser_control")) {
    await sql`ALTER TABLE chat_sessions DROP COLUMN browser_control`.execute(db);
  }
  if (names.has("computer_control")) {
    await sql`ALTER TABLE chat_sessions DROP COLUMN computer_control`.execute(db);
  }
};

const ensureChatSessionContextChipColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (!columns.rows.some((column) => column.name === "default_worker_id")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN default_worker_id text`.execute(db);
  }
  if (!columns.rows.some((column) => column.name === "default_workflow_id")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN default_workflow_id text`.execute(db);
  }
};

const ensureChatSessionWorkspaceColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.some((column) => column.name === "workspace_path")) return;
  await sql`ALTER TABLE chat_sessions ADD COLUMN workspace_path text`.execute(db);
};

const ensureChatSessionLastReadAtColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  if (columns.rows.some((column) => column.name === "last_read_at")) return;
  await sql`ALTER TABLE chat_sessions ADD COLUMN last_read_at text`.execute(db);
};

const ensureChatSessionSettlementColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_sessions)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  if (!names.has("settled_override")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN settled_override text`.execute(db);
  }
  if (!names.has("settled_at")) {
    await sql`ALTER TABLE chat_sessions ADD COLUMN settled_at text`.execute(db);
  }
  if (names.has("archived")) {
    await sql`
      UPDATE chat_sessions
      SET settled_override = 'settled', settled_at = COALESCE(settled_at, updated_at)
      WHERE archived = 1 AND settled_override IS NULL
    `.execute(db);
  }
};

const createChatRunsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_runs")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("session_id", "text", (col) =>
      col.notNull().references("chat_sessions.id").onDelete("cascade"),
    )
    .addColumn("user_message_id", "text", (col) =>
      col.notNull().references("chat_messages.id").onDelete("cascade"),
    )
    .addColumn("assistant_message_id", "text", (col) => col.notNull())
    .addColumn("runtime", "text", (col) => col.notNull())
    .addColumn("log_file_path", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("running"))
    .addColumn("runtime_session_id", "text")
    .addColumn("resume_session_id", "text")
    .addColumn("failure_kind", "text")
    .addColumn("interruption_kind", "text")
    .addColumn("context_strategy", "text")
    .addColumn("workspace_path", "text")
    .addColumn("timeout_policy", "text")
    .addColumn("retry_of_run_id", "text", (col) => col.references("chat_runs.id"))
    .addColumn("runtime_session_state", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addUniqueConstraint("uq_chat_runs_user_message", ["user_message_id"])
    .addUniqueConstraint("uq_chat_runs_assistant_message", ["assistant_message_id"])
    .execute();

  await db.schema
    .createIndex("idx_chat_runs_session_status")
    .ifNotExists()
    .on("chat_runs")
    .columns(["session_id", "status"])
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_runs_running_session
    ON chat_runs(session_id)
    WHERE status = 'running'
  `.execute(db);
};

/** Chat-native workflow runs: one sequential background run per session. */
const createWorkflowRunsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("workflow_runs")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("session_id", "text", (col) =>
      col.notNull().references("chat_sessions.id").onDelete("cascade"),
    )
    .addColumn("workflow_id", "text", (col) => col.notNull())
    .addColumn("workflow_name", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("running"))
    .addColumn("request", "text", (col) => col.notNull())
    .addColumn("user_message_id", "text", (col) =>
      col.notNull().references("chat_messages.id").onDelete("cascade"),
    )
    .addColumn("answer_message_id", "text")
    .addColumn("current_step_id", "text")
    .addColumn("visited_steps", "text")
    .addColumn("iteration", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("result", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("completed_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_workflow_runs_session_status")
    .ifNotExists()
    .on("workflow_runs")
    .columns(["session_id", "status"])
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_runs_running_session
    ON workflow_runs(session_id)
    WHERE status = 'running'
  `.execute(db);
};

/** Upgrade path for DBs that already have chat_runs without failure classification. */
const ensureChatRunFailureColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_runs)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  if (!names.has("resume_session_id")) {
    await sql`ALTER TABLE chat_runs ADD COLUMN resume_session_id text`.execute(db);
  }
  if (!names.has("failure_kind")) {
    await sql`ALTER TABLE chat_runs ADD COLUMN failure_kind text`.execute(db);
  }
};

const ensureChatRunContinuityColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_runs)`.execute(db);
  const names = new Set(columns.rows.map((column) => column.name));
  const additions = [
    ["interruption_kind", "text"],
    ["context_strategy", "text"],
    ["workspace_path", "text"],
    ["timeout_policy", "text"],
    ["retry_of_run_id", "text REFERENCES chat_runs(id)"],
    ["runtime_session_state", "text"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await sql.raw(`ALTER TABLE chat_runs ADD COLUMN ${name} ${definition}`).execute(db);
    }
  }
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_runs_retry_of_run
    ON chat_runs(retry_of_run_id)
    WHERE retry_of_run_id IS NOT NULL
  `.execute(db);
};

const ensureChatRunDelegationColumn = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{ name: string }>`PRAGMA table_info(chat_runs)`.execute(db);
  if (columns.rows.some((column) => column.name === "delegation_runs")) return;
  await sql`ALTER TABLE chat_runs ADD COLUMN delegation_runs text`.execute(db);
};

const createTaskAssignmentsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("task_assignments")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull().references("tasks.id").onDelete("cascade"))
    .addColumn("agent_id", "text", (col) =>
      col.notNull().references("agents.id").onDelete("cascade"),
    )
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("status_column", "text", (col) => col.notNull())
    .addColumn("is_current", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_task_assignments_task")
    .ifNotExists()
    .on("task_assignments")
    .column("task_id")
    .execute();

  await db.schema
    .createIndex("idx_task_assignments_agent")
    .ifNotExists()
    .on("task_assignments")
    .column("agent_id")
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_assignments_current_task
    ON task_assignments(task_id)
    WHERE is_current = 1
  `.execute(db);
};

const createTaskSourcesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("task_sources")
    .ifNotExists()
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("external_id", "text", (col) => col.notNull())
    .addColumn("external_ref", "text", (col) => col.notNull())
    .addColumn("external_url", "text", (col) => col.notNull())
    .addColumn("title_snapshot", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_task_sources_repo_external_id")
    .ifNotExists()
    .on("task_sources")
    .columns(["repo_id", "provider", "external_id"])
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_task_sources_task_provider")
    .ifNotExists()
    .on("task_sources")
    .columns(["task_id", "provider"])
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_task_sources_repo_external_ref")
    .ifNotExists()
    .on("task_sources")
    .columns(["repo_id", "provider", "external_ref"])
    .execute();
};

const createTaskDependenciesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("task_dependencies")
    .ifNotExists()
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("depends_on_task_id", "text", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addCheckConstraint("chk_task_dependencies_not_self", sql`task_id <> depends_on_task_id`)
    .addPrimaryKeyConstraint("pk_task_dependencies", ["task_id", "depends_on_task_id", "source"])
    .execute();

  await ensureTaskDependenciesPrimaryKeyIncludesSource(db);

  await db.schema
    .createIndex("idx_task_dependencies_depends_on")
    .ifNotExists()
    .on("task_dependencies")
    .column("depends_on_task_id")
    .execute();
};

const ensureTaskDependenciesPrimaryKeyIncludesSource = async (
  db: Kysely<Database>,
): Promise<void> => {
  const primaryKeyColumns = await getTaskDependenciesPrimaryKeyColumns(db);
  if (primaryKeyColumns.includes("source")) {
    return;
  }

  await db.transaction().execute(async (trx) => {
    await sql`DROP TABLE IF EXISTS task_dependencies_v2`.execute(trx);
    await sql`
      CREATE TABLE task_dependencies_v2 (
        task_id text NOT NULL,
        depends_on_task_id text NOT NULL,
        source text NOT NULL,
        created_at text NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT chk_task_dependencies_not_self CHECK (task_id <> depends_on_task_id),
        CONSTRAINT pk_task_dependencies PRIMARY KEY (task_id, depends_on_task_id, source)
      )
    `.execute(trx);
    await sql`
      INSERT OR IGNORE INTO task_dependencies_v2 (
        task_id,
        depends_on_task_id,
        source,
        created_at
      )
      SELECT
        task_id,
        depends_on_task_id,
        source,
        MIN(created_at) AS created_at
      FROM task_dependencies
      GROUP BY task_id, depends_on_task_id, source
    `.execute(trx);
    await sql`DROP TABLE task_dependencies`.execute(trx);
    await sql`ALTER TABLE task_dependencies_v2 RENAME TO task_dependencies`.execute(trx);
  });
};

const getTaskDependenciesPrimaryKeyColumns = async (db: Kysely<Database>): Promise<string[]> => {
  const columns = await sql<{
    name: string;
    pk: number;
  }>`PRAGMA table_info(task_dependencies)`.execute(db);

  return columns.rows
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
};

const createExecutionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("executions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("workflow_id", "text", (col) => col.notNull().defaultTo("aop-default-gpt"))
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("visited_steps", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("iteration", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("completed_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_executions_task_id")
    .ifNotExists()
    .on("executions")
    .column("task_id")
    .execute();
};

const createStepExecutionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("step_executions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("execution_id", "text", (col) =>
      col.notNull().references("executions.id").onDelete("cascade"),
    )
    .addColumn("step_id", "text")
    .addColumn("step_type", "text")
    .addColumn("agent_pid", "integer")
    .addColumn("session_id", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("exit_code", "integer")
    .addColumn("signal", "text")
    .addColumn("pause_context", "text")
    .addColumn("error", "text")
    .addColumn("attempt", "integer")
    .addColumn("iteration", "integer")
    .addColumn("signals_json", "text")
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("ended_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_step_executions_execution_id")
    .ifNotExists()
    .on("step_executions")
    .column("execution_id")
    .execute();
};

const createStepUsageTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("step_usage")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("step_execution_id", "text", (col) =>
      col.notNull().references("step_executions.id").onDelete("cascade"),
    )
    .addColumn("provider", "text")
    .addColumn("model", "text")
    .addColumn("input_tokens", "integer")
    .addColumn("output_tokens", "integer")
    .addColumn("total_tokens", "integer")
    .addColumn("cost_usd", "real")
    .addColumn("duration_ms", "integer")
    .addColumn("usage_source", "text")
    .addColumn("raw_usage_json", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_step_usage_step_execution_id")
    .ifNotExists()
    .on("step_usage")
    .column("step_execution_id")
    .execute();
};

const createStepLogsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("step_logs")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("step_execution_id", "text", (col) =>
      col.notNull().references("step_executions.id").onDelete("cascade"),
    )
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_step_logs_step_execution_id")
    .ifNotExists()
    .on("step_logs")
    .column("step_execution_id")
    .execute();
};

const createRuntimeEventsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("runtime_events")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("execution_id", "text", (col) =>
      col.notNull().references("executions.id").onDelete("cascade"),
    )
    .addColumn("step_execution_id", "text", (col) =>
      col.notNull().references("step_executions.id").onDelete("cascade"),
    )
    .addColumn("session_id", "text")
    .addColumn("agent_id", "text")
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("message", "text")
    .addColumn("tool_name", "text")
    .addColumn("status", "text")
    .addColumn("source_kind", "text", (col) => col.notNull())
    .addColumn("source_id", "text", (col) => col.notNull())
    .addColumn("source_index", "integer")
    .addColumn("occurred_at", "text", (col) => col.notNull())
    .addColumn("metadata_json", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_runtime_events_task_id")
    .ifNotExists()
    .on("runtime_events")
    .column("task_id")
    .execute();

  await db.schema
    .createIndex("idx_runtime_events_execution_id")
    .ifNotExists()
    .on("runtime_events")
    .column("execution_id")
    .execute();

  await db.schema
    .createIndex("idx_runtime_events_source")
    .ifNotExists()
    .on("runtime_events")
    .columns(["source_kind", "source_id", "source_index"])
    .unique()
    .execute();
};

const dropLegacySessionTables = async (db: Kysely<Database>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS session_messages`.execute(db);
  await sql`DROP TABLE IF EXISTS interactive_sessions`.execute(db);
};

const dropRetiredIntakeTables = async (db: Kysely<Database>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS postit_image_attachments`.execute(db);
  await sql`DROP TABLE IF EXISTS postits`.execute(db);
  await sql`DROP TABLE IF EXISTS planning_runs`.execute(db);
  await sql`DROP TABLE IF EXISTS planning_postits`.execute(db);
};

/** The license system was removed; drop its persisted settings keys. */
const dropRetiredLicenseSettings = async (db: Kysely<Database>): Promise<void> => {
  await sql`
    DELETE FROM settings
    WHERE key IN (
      'license_key',
      'license_entitlement_json',
      'license_machine_id',
      'license_server_url',
      'license_validated_at',
      'license_lemon_instance_id'
    )
  `.execute(db);
};

const createSchedulerTriggersTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("scheduler_triggers")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("action", "text", (col) => col.notNull())
    .addColumn("cadence_secs", "integer", (col) => col.notNull())
    .addColumn("enabled", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("max_items_per_run", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("require_approval_before_handoff", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("allowed_sources_json", "text")
    .addColumn("last_run_at", "text")
    .addColumn("last_result_json", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createIndex("idx_scheduler_triggers_repo_id")
    .ifNotExists()
    .on("scheduler_triggers")
    .column("repo_id")
    .execute();
};

const createSignalsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("signals")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("source_task_id", "text", (col) => col.references("tasks.id").onDelete("set null"))
    .addColumn("source_execution_id", "text", (col) =>
      col.references("executions.id").onDelete("set null"),
    )
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("body", "text", (col) => col.notNull())
    .addColumn("provenance", "text", (col) => col.notNull())
    .addColumn("confidence", "text", (col) => col.notNull())
    .addColumn("consumed_at", "text")
    .addColumn("consumed_task_id", "text", (col) => col.references("tasks.id").onDelete("set null"))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createIndex("idx_signals_repo_open")
    .ifNotExists()
    .on("signals")
    .columns(["repo_id", "consumed_at"])
    .execute();
};
