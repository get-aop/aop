import type {
  ChatCheckpointCaptureStatus,
  ChatWorkLogEventKind,
  ChatWorkLogPhase,
  ChatWorkLogStatus,
  ChatWorkLogToolKind,
  SessionDiffFileStatus,
} from "@aop/common";
import type { Generated, Insertable, Selectable, Updateable } from "kysely";

export type ChatRevertOperationStatus =
  | "pending"
  | "applying"
  | "applied"
  | "rollback_pending"
  | "rolled_back"
  | "recovery_required"
  | "failed";

/** Three-state contract for `chat_revert_operations.cleanup_status`. */
export type ChatCleanupStatus = "pending" | "completed" | "failed";

/**
 * Cleanup jobs need a claimed state so two workers cannot delete the same refs.
 * Kept separate from {@link ChatCleanupStatus} so the revert contract stays
 * three-state.
 */
export type ChatCleanupJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ChatRunCheckpointsTable {
  run_id: string;
  workspace_path: string;
  worktree_root: string;
  git_common_dir: string;
  /** Null on detached HEAD; never a synthetic placeholder. */
  branch: string | null;
  /** Null in an unborn repository that has no commit yet. */
  head_oid: string | null;
  before_ref: string;
  after_ref: string;
  before_oid: string | null;
  after_oid: string | null;
  before_status: ChatCheckpointCaptureStatus;
  after_status: ChatCheckpointCaptureStatus;
  before_error: string | null;
  after_error: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ChatRunChangedFilesTable {
  run_id: string;
  path: string;
  old_path: string | null;
  status: SessionDiffFileStatus;
  additions: number;
  deletions: number;
  binary: Generated<boolean>;
}

export interface ChatRunEventsTable {
  id: string;
  run_id: string;
  sequence: number;
  source_kind: string;
  source_index: number;
  source_subindex: Generated<number>;
  provider: string | null;
  kind: ChatWorkLogEventKind;
  phase: ChatWorkLogPhase | null;
  status: ChatWorkLogStatus | null;
  correlation_id: string | null;
  title: string | null;
  summary: string | null;
  detail: string | null;
  tool_name: string | null;
  tool_kind: ChatWorkLogToolKind | null;
  input_json: string | null;
  output_json: string | null;
  output_text: string | null;
  exit_code: number | null;
  payload_truncated: Generated<boolean>;
  occurred_at: string | null;
  metadata_json: string | null;
  created_at: Generated<string>;
}

export interface ChatRevertOperationsTable {
  id: string;
  session_id: string;
  target_user_message_id: string;
  target_assistant_message_id: string;
  target_run_id: string;
  target_turn_index: number;
  target_checkpoint_ref: string;
  backup_checkpoint_ref: string;
  status: ChatRevertOperationStatus;
  refs_to_delete_json: string;
  artifact_paths_json: string;
  cleanup_status: ChatCleanupStatus;
  error_message: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  completed_at: string | null;
  cleanup_completed_at: string | null;
}

export interface ChatCheckpointCleanupJobsTable {
  id: string;
  workspace_path: string;
  worktree_root: string;
  git_common_dir: string;
  refs_json: string;
  /** Sessions that owned the refs; empty for rows written before ownership was recorded. */
  session_ids_json: Generated<string>;
  status: ChatCleanupJobStatus;
  error_message: string | null;
  /** Lease identifier of the worker currently holding the job. */
  claim_token: string | null;
  /** Lease timestamp used to recover claims abandoned by a crashed server. */
  claimed_at: string | null;
  attempts: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  completed_at: string | null;
}

export interface ChatHistoryDatabase {
  chat_run_checkpoints: ChatRunCheckpointsTable;
  chat_run_changed_files: ChatRunChangedFilesTable;
  chat_run_events: ChatRunEventsTable;
  chat_revert_operations: ChatRevertOperationsTable;
  chat_checkpoint_cleanup_jobs: ChatCheckpointCleanupJobsTable;
}

export type ChatRunCheckpoint = Selectable<ChatRunCheckpointsTable>;
export type NewChatRunCheckpoint = Insertable<ChatRunCheckpointsTable>;
export type ChatRunCheckpointUpdate = Updateable<ChatRunCheckpointsTable>;

export type ChatRunChangedFile = Selectable<ChatRunChangedFilesTable>;
export type NewChatRunChangedFile = Insertable<ChatRunChangedFilesTable>;

export type ChatRunEvent = Selectable<ChatRunEventsTable>;
export type NewChatRunEvent = Insertable<ChatRunEventsTable>;

export type ChatRevertOperation = Selectable<ChatRevertOperationsTable>;
export type NewChatRevertOperation = Insertable<ChatRevertOperationsTable>;
export type ChatRevertOperationUpdate = Updateable<ChatRevertOperationsTable>;

export type ChatCheckpointCleanupJob = Selectable<ChatCheckpointCleanupJobsTable>;
export type NewChatCheckpointCleanupJob = Insertable<ChatCheckpointCleanupJobsTable>;
export type ChatCheckpointCleanupJobUpdate = Updateable<ChatCheckpointCleanupJobsTable>;
