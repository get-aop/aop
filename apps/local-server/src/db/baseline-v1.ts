/**
 * Schema baseline v1: the database as the Projects product first creates it.
 * It replaces the 60 replay-every-start migration steps of the old aop.sqlite,
 * which is never opened (the file is now projects.sqlite).
 *
 * Foreign keys are enforced (see connection.ts). Every action below is a
 * decision, not a default:
 * - CASCADE where the child rows are derived data with no external resource:
 *   messages and runs of a session, changed files, run events, delegation runs,
 *   runtime models. A parent delete removes them in the same statement.
 * - RESTRICT chat_run_checkpoints.run_id and chat_sessions.repo_id: these rows
 *   name hidden git refs and log directories that a cascade cannot clean up.
 *   The chat and repo domains record the cleanup jobs first and delete children
 *   before parents; a code path that skips that fails loudly instead of
 *   silently dropping the only record of refs it must delete.
 * - SET NULL chat_runs.retry_of_run_id: a retry outlives the run it retried,
 *   and history deletes runs in batches that can split a retry chain.
 * - No foreign key on chat_revert_operations and chat_checkpoint_cleanup_jobs:
 *   they are ledgers of cleanup work that must survive the rows they describe.
 * - No foreign key on chat_sessions.runtime_configuration_id: a session keeps
 *   its runtime binding after that runtime configuration is removed.
 */
export const BASELINE_V1_STATEMENTS: readonly string[] = [
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE runtime_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_provider TEXT NOT NULL,
    command TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    fast_mode INTEGER NOT NULL DEFAULT 0,
    exec_host_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX idx_runtime_profiles_name_nocase
    ON runtime_profiles(name COLLATE NOCASE)`,

  `CREATE TABLE runtime_configuration_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    driver TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    supports_fast_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX idx_runtime_configuration_provider_name_nocase
    ON runtime_configuration_providers(name COLLATE NOCASE)`,

  `CREATE TABLE runtime_configuration_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES runtime_configuration_providers(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    model TEXT NOT NULL,
    thinking_levels TEXT NOT NULL,
    fast_mode INTEGER NOT NULL DEFAULT 0,
    built_in INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    default_thinking_level TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX idx_runtime_configuration_model_provider_name
    ON runtime_configuration_models(provider_id, model)`,

  `CREATE TABLE repos (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT,
    remote_origin TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    repo_id TEXT REFERENCES repos(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    named INTEGER NOT NULL DEFAULT 0,
    runtime TEXT NOT NULL,
    runtime_configuration_id TEXT,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    runtime_alias TEXT,
    runtime_session_id TEXT,
    workspace_path TEXT,
    fast_mode INTEGER NOT NULL DEFAULT 0,
    runtime_access_mode TEXT NOT NULL DEFAULT 'full-access',
    pinned INTEGER NOT NULL DEFAULT 0,
    settled_override TEXT,
    settled_at TEXT,
    last_read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX idx_chat_sessions_repo ON chat_sessions(repo_id)`,
  `CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at)`,

  `CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    action TEXT,
    activity TEXT,
    turn_index INTEGER NOT NULL DEFAULT 0,
    disposition TEXT NOT NULL DEFAULT 'immediate',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX idx_chat_messages_session_created ON chat_messages(session_id, created_at)`,
  `CREATE INDEX idx_chat_messages_session_role_created
    ON chat_messages(session_id, role, created_at)`,

  `CREATE TABLE chat_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    assistant_message_id TEXT NOT NULL,
    runtime TEXT NOT NULL,
    log_file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    runtime_session_id TEXT,
    resume_session_id TEXT,
    failure_kind TEXT,
    interruption_kind TEXT,
    context_strategy TEXT,
    workspace_path TEXT,
    timeout_policy TEXT,
    retry_of_run_id TEXT REFERENCES chat_runs(id) ON DELETE SET NULL,
    runtime_session_state TEXT,
    error_message TEXT,
    pid INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_chat_runs_user_message UNIQUE (user_message_id),
    CONSTRAINT uq_chat_runs_assistant_message UNIQUE (assistant_message_id)
  )`,
  `CREATE INDEX idx_chat_runs_session_status ON chat_runs(session_id, status)`,
  `CREATE UNIQUE INDEX uq_chat_runs_running_session
    ON chat_runs(session_id) WHERE status = 'running'`,
  `CREATE UNIQUE INDEX uq_chat_runs_retry_of_run
    ON chat_runs(retry_of_run_id) WHERE retry_of_run_id IS NOT NULL`,

  `CREATE TABLE chat_delegation_runs (
    id TEXT PRIMARY KEY,
    chat_run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    runtime TEXT NOT NULL,
    runtime_alias TEXT,
    runtime_configuration_id TEXT,
    model TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    fast_mode INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    activity TEXT,
    runtime_session_id TEXT,
    log_file_path TEXT NOT NULL,
    error TEXT,
    tool_use_id TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_chat_delegation_runs_chat_run ON chat_delegation_runs(chat_run_id)`,

  `CREATE TABLE chat_run_checkpoints (
    run_id TEXT PRIMARY KEY REFERENCES chat_runs(id) ON DELETE RESTRICT,
    workspace_path TEXT NOT NULL,
    worktree_root TEXT NOT NULL,
    git_common_dir TEXT NOT NULL,
    branch TEXT,
    head_oid TEXT,
    before_ref TEXT NOT NULL,
    after_ref TEXT NOT NULL,
    before_oid TEXT,
    after_oid TEXT,
    before_status TEXT NOT NULL DEFAULT 'pending',
    after_status TEXT NOT NULL DEFAULT 'pending',
    before_error TEXT,
    after_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE chat_run_changed_files (
    run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    old_path TEXT,
    status TEXT NOT NULL,
    additions INTEGER NOT NULL,
    deletions INTEGER NOT NULL,
    binary INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT pk_chat_run_changed_files PRIMARY KEY (run_id, path)
  )`,

  `CREATE TABLE chat_run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    source_kind TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    source_subindex INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    kind TEXT NOT NULL,
    phase TEXT,
    status TEXT,
    correlation_id TEXT,
    title TEXT,
    summary TEXT,
    detail TEXT,
    tool_name TEXT,
    tool_kind TEXT,
    input_json TEXT,
    output_json TEXT,
    output_text TEXT,
    exit_code INTEGER,
    payload_truncated INTEGER NOT NULL DEFAULT 0,
    occurred_at TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX idx_chat_run_events_replay
    ON chat_run_events(run_id, source_kind, source_index, source_subindex)`,
  `CREATE INDEX idx_chat_run_events_run_sequence ON chat_run_events(run_id, sequence)`,

  `CREATE TABLE chat_revert_operations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    target_user_message_id TEXT NOT NULL,
    target_assistant_message_id TEXT NOT NULL,
    target_run_id TEXT NOT NULL,
    target_turn_index INTEGER NOT NULL,
    target_checkpoint_ref TEXT NOT NULL,
    backup_checkpoint_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    refs_to_delete_json TEXT NOT NULL DEFAULT '[]',
    artifact_paths_json TEXT NOT NULL DEFAULT '[]',
    cleanup_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    cleanup_completed_at TEXT
  )`,
  `CREATE INDEX idx_chat_revert_operations_session_status
    ON chat_revert_operations(session_id, status)`,
  `CREATE INDEX idx_chat_revert_operations_cleanup
    ON chat_revert_operations(cleanup_status, created_at)`,

  `CREATE TABLE chat_checkpoint_cleanup_jobs (
    id TEXT PRIMARY KEY,
    workspace_path TEXT NOT NULL,
    worktree_root TEXT NOT NULL,
    git_common_dir TEXT NOT NULL,
    refs_json TEXT NOT NULL,
    session_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    claim_token TEXT,
    claimed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE INDEX idx_chat_checkpoint_cleanup_jobs_status
    ON chat_checkpoint_cleanup_jobs(status, created_at)`,
  `CREATE INDEX idx_chat_checkpoint_cleanup_jobs_claim
    ON chat_checkpoint_cleanup_jobs(status, claimed_at)`,
];
