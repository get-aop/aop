import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "./schema.ts";

export const runChatHistoryMigrations = async (db: Kysely<Database>): Promise<void> => {
  await createRunCheckpointsTable(db);
  await repairCheckpointAuditNullability(db);
  await createRunChangedFilesTable(db);
  await createRunEventsTable(db);
  await createRevertOperationsTable(db);
  await createCheckpointCleanupJobsTable(db);
  await ensureCheckpointCleanupClaimColumns(db);
};

const CHECKPOINT_COLUMNS = [
  "run_id",
  "workspace_path",
  "worktree_root",
  "git_common_dir",
  "branch",
  "head_oid",
  "before_ref",
  "after_ref",
  "before_oid",
  "after_oid",
  "before_status",
  "after_status",
  "before_error",
  "after_error",
  "created_at",
  "updated_at",
] as const;

const createRunCheckpointsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_run_checkpoints")
    .ifNotExists()
    .addColumn("run_id", "text", (col) =>
      col.primaryKey().references("chat_runs.id").onDelete("cascade"),
    )
    .addColumn("workspace_path", "text", (col) => col.notNull())
    .addColumn("worktree_root", "text", (col) => col.notNull())
    .addColumn("git_common_dir", "text", (col) => col.notNull())
    // branch is null on detached HEAD and head_oid is null in an unborn repo;
    // storing placeholders instead would corrupt the capture audit trail.
    .addColumn("branch", "text")
    .addColumn("head_oid", "text")
    .addColumn("before_ref", "text", (col) => col.notNull())
    .addColumn("after_ref", "text", (col) => col.notNull())
    .addColumn("before_oid", "text")
    .addColumn("after_oid", "text")
    .addColumn("before_status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("after_status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("before_error", "text")
    .addColumn("after_error", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
};

/**
 * The first foundation cut created `branch`/`head_oid` as NOT NULL. SQLite
 * cannot drop a NOT NULL constraint in place, so rebuild the table inside one
 * transaction, preserving every row and recreating every index.
 */
const repairCheckpointAuditNullability = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{
    name: string;
    notnull: number;
  }>`PRAGMA table_info(chat_run_checkpoints)`.execute(db);
  const needsRepair = columns.rows.some(
    (column) => (column.name === "branch" || column.name === "head_oid") && column.notnull === 1,
  );
  if (!needsRepair) return;

  const indexes = await sql<{ sql: string }>`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'chat_run_checkpoints' AND sql IS NOT NULL
  `.execute(db);
  const columnList = CHECKPOINT_COLUMNS.join(", ");

  await db.transaction().execute(async (trx) => {
    await sql`ALTER TABLE chat_run_checkpoints RENAME TO chat_run_checkpoints_legacy`.execute(trx);
    await createRunCheckpointsTable(trx);
    await sql
      .raw(
        `INSERT INTO chat_run_checkpoints (${columnList}) SELECT ${columnList} FROM chat_run_checkpoints_legacy`,
      )
      .execute(trx);
    await sql`DROP TABLE chat_run_checkpoints_legacy`.execute(trx);
    for (const index of indexes.rows) {
      await sql.raw(index.sql).execute(trx);
    }
  });
};

const createRunChangedFilesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_run_changed_files")
    .ifNotExists()
    .addColumn("run_id", "text", (col) =>
      col.notNull().references("chat_runs.id").onDelete("cascade"),
    )
    .addColumn("path", "text", (col) => col.notNull())
    .addColumn("old_path", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("additions", "integer", (col) => col.notNull())
    .addColumn("deletions", "integer", (col) => col.notNull())
    .addColumn("binary", "integer", (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint("pk_chat_run_changed_files", ["run_id", "path"])
    .execute();
};

const createRunEventsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_run_events")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("run_id", "text", (col) =>
      col.notNull().references("chat_runs.id").onDelete("cascade"),
    )
    .addColumn("sequence", "integer", (col) => col.notNull())
    .addColumn("source_kind", "text", (col) => col.notNull())
    .addColumn("source_index", "integer", (col) => col.notNull())
    .addColumn("source_subindex", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("provider", "text")
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("phase", "text")
    .addColumn("status", "text")
    .addColumn("correlation_id", "text")
    .addColumn("title", "text")
    .addColumn("summary", "text")
    .addColumn("detail", "text")
    .addColumn("tool_name", "text")
    .addColumn("tool_kind", "text")
    .addColumn("input_json", "text")
    .addColumn("output_json", "text")
    .addColumn("output_text", "text")
    .addColumn("exit_code", "integer")
    .addColumn("payload_truncated", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("occurred_at", "text")
    .addColumn("metadata_json", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_chat_run_events_replay")
    .unique()
    .ifNotExists()
    .on("chat_run_events")
    .columns(["run_id", "source_kind", "source_index", "source_subindex"])
    .execute();

  await db.schema
    .createIndex("idx_chat_run_events_run_sequence")
    .ifNotExists()
    .on("chat_run_events")
    .columns(["run_id", "sequence"])
    .execute();
};

const createRevertOperationsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_revert_operations")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("session_id", "text", (col) => col.notNull())
    .addColumn("target_user_message_id", "text", (col) => col.notNull())
    .addColumn("target_assistant_message_id", "text", (col) => col.notNull())
    .addColumn("target_run_id", "text", (col) => col.notNull())
    .addColumn("target_turn_index", "integer", (col) => col.notNull())
    .addColumn("target_checkpoint_ref", "text", (col) => col.notNull())
    .addColumn("backup_checkpoint_ref", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("refs_to_delete_json", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("artifact_paths_json", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("cleanup_status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("completed_at", "text")
    .addColumn("cleanup_completed_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_chat_revert_operations_session_status")
    .ifNotExists()
    .on("chat_revert_operations")
    .columns(["session_id", "status"])
    .execute();

  await db.schema
    .createIndex("idx_chat_revert_operations_cleanup")
    .ifNotExists()
    .on("chat_revert_operations")
    .columns(["cleanup_status", "created_at"])
    .execute();
};

const createCheckpointCleanupJobsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("chat_checkpoint_cleanup_jobs")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("workspace_path", "text", (col) => col.notNull())
    .addColumn("worktree_root", "text", (col) => col.notNull())
    .addColumn("git_common_dir", "text", (col) => col.notNull())
    .addColumn("refs_json", "text", (col) => col.notNull())
    .addColumn("session_ids_json", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("error_message", "text")
    .addColumn("claim_token", "text")
    .addColumn("claimed_at", "text")
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("completed_at", "text")
    .execute();
};

/**
 * Upgrades a database created by the first foundation cut, which had no claim
 * state. Indexes are created here (not with the table) so the claim index is
 * only attempted once `claimed_at` exists on both fresh and legacy databases.
 */
const ensureCheckpointCleanupClaimColumns = async (db: Kysely<Database>): Promise<void> => {
  const columns = await sql<{
    name: string;
  }>`PRAGMA table_info(chat_checkpoint_cleanup_jobs)`.execute(db);
  const existing = new Set(columns.rows.map((column) => column.name));

  if (!existing.has("session_ids_json")) {
    await sql`ALTER TABLE chat_checkpoint_cleanup_jobs ADD COLUMN session_ids_json text NOT NULL DEFAULT '[]'`.execute(
      db,
    );
  }
  if (!existing.has("claim_token")) {
    await sql`ALTER TABLE chat_checkpoint_cleanup_jobs ADD COLUMN claim_token text`.execute(db);
  }
  if (!existing.has("claimed_at")) {
    await sql`ALTER TABLE chat_checkpoint_cleanup_jobs ADD COLUMN claimed_at text`.execute(db);
  }
  if (!existing.has("attempts")) {
    await sql`ALTER TABLE chat_checkpoint_cleanup_jobs ADD COLUMN attempts integer NOT NULL DEFAULT 0`.execute(
      db,
    );
  }

  await createCleanupJobIndexes(db);
};

const createCleanupJobIndexes = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createIndex("idx_chat_checkpoint_cleanup_jobs_status")
    .ifNotExists()
    .on("chat_checkpoint_cleanup_jobs")
    .columns(["status", "created_at"])
    .execute();

  await db.schema
    .createIndex("idx_chat_checkpoint_cleanup_jobs_claim")
    .ifNotExists()
    .on("chat_checkpoint_cleanup_jobs")
    .columns(["status", "claimed_at"])
    .execute();
};
