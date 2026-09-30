/**
 * Migration v2: the Projects domain, added on top of baseline v1. Version 1 is never
 * edited; a database that applied it only runs these statements.
 *
 * New tables: projects, project_repos, memory_files, devices, event_log.
 * A thread is a chat_sessions row: it gains the thread columns below, and a project's
 * coordinator is the chat_sessions row with kind = 'coordinator'. Sessions that belong
 * to no project (everything v1 wrote) keep every new column null or at its default.
 *
 * Foreign keys are enforced (see connection.ts). Every action below is a decision:
 * - CASCADE project_repos.project_id and memory_files.project_id: the rows are derived
 *   from the project and name no external resource, so deleting a project removes them.
 * - RESTRICT chat_sessions.project_id: threads own git worktrees, branches, log
 *   directories and running processes that a cascade cannot clean up (the reason
 *   chat_sessions.repo_id is RESTRICT in v1). Deleting a project stops and deletes each
 *   session through the session graph deletion first; a path that skips it fails loudly.
 * - RESTRICT project_repos.repo_id: an attached repo is a project setting. Removing the
 *   repo must go through the project so clients receive the settings change, not vanish
 *   from it silently through a cascade.
 * - No foreign key on event_log.project_id: the log is a ledger clients resume from with
 *   `?after=<id>`. The `project.removed` entry has to outlive the project row it
 *   announces, and an unattended cascade would delete it with the project.
 * - devices has no relations: one owner, per-device tokens.
 *
 * No CHECK lists the values of a status, kind, level or event type. SQLite cannot alter
 * a CHECK in place, and the runner cannot rebuild a table that has foreign-key children,
 * so such a list would freeze the vocabulary. Those values are typed in @aop/common and
 * validated where input enters. The CHECKs below couple columns to each other (a blocked
 * question exists exactly while the thread waits on the user), which does not change
 * when a value is added.
 *
 * ADD COLUMN cannot take a non-constant default, so the thread columns are nullable
 * unless a constant default exists; the CHECKs require them for project sessions.
 * Timestamps default to the ISO-8601 form `Date.toISOString()` writes.
 */
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const PROJECTS_V2_STATEMENTS: readonly string[] = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    coordinator_provider TEXT NOT NULL,
    coordinator_model TEXT,
    coordinator_effort TEXT,
    thread_provider TEXT NOT NULL,
    thread_model TEXT,
    thread_effort TEXT,
    notification_level TEXT NOT NULL DEFAULT 'coordinator',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  )`,

  `CREATE TABLE project_repos (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    CONSTRAINT pk_project_repos PRIMARY KEY (project_id, repo_id)
  )`,
  `CREATE INDEX idx_project_repos_repo ON project_repos(repo_id)`,

  `CREATE TABLE memory_files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    CONSTRAINT pk_memory_files PRIMARY KEY (project_id, name)
  )`,

  // Revoking a device deletes its row. Only the hash of the bearer token is stored.
  `CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    last_seen_at TEXT
  )`,

  // AUTOINCREMENT, not a plain rowid: trimming old entries must never let an id be reused,
  // or a client resuming from an old cursor would skip or repeat entries.
  `CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  )`,
  `CREATE INDEX idx_event_log_project ON event_log(project_id, id)`,

  // Thread columns on chat_sessions. Each CHECK may name only columns added before it.
  `ALTER TABLE chat_sessions ADD COLUMN project_id TEXT
    REFERENCES projects(id) ON DELETE RESTRICT`,
  // 'coordinator' or 'thread'; null exactly when the session belongs to no project.
  `ALTER TABLE chat_sessions ADD COLUMN kind TEXT
    CHECK ((project_id IS NULL) = (kind IS NULL))`,
  // A ThreadStatus, present exactly on threads.
  `ALTER TABLE chat_sessions ADD COLUMN state TEXT
    CHECK ((kind IS 'thread') = (state IS NOT NULL))`,
  // JSON BlockedQuestion, present exactly while the thread waits on the user.
  `ALTER TABLE chat_sessions ADD COLUMN blocked_question_json TEXT
    CHECK ((blocked_question_json IS NOT NULL) = (state IS 'waiting-on-you')
      AND json_type(blocked_question_json) = 'object')`,
  // JSON array of ThreadStep: the checklist. The n/m progress ring is derived from it.
  `ALTER TABLE chat_sessions ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(steps_json) AND json_type(steps_json) = 'array')`,
  `ALTER TABLE chat_sessions ADD COLUMN status_line TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN branch TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN pr_number INTEGER`,
  `ALTER TABLE chat_sessions ADD COLUMN pr_url TEXT
    CHECK ((pr_number IS NULL) = (pr_url IS NULL))`,
  // A PullRequestState. A landing thread has a pull request.
  `ALTER TABLE chat_sessions ADD COLUMN pr_state TEXT
    CHECK ((pr_number IS NULL) = (pr_state IS NULL)
      AND (state IS NOT 'landing' OR pr_number IS NOT NULL))`,
  // JSON ThreadTarget: where the thread runs. Phase 1 runs every thread on the host.
  `ALTER TABLE chat_sessions ADD COLUMN target_json TEXT NOT NULL DEFAULT '{"kind":"host"}'
    CHECK (json_valid(target_json) AND json_type(target_json, '$.kind') IS 'text')`,
  `ALTER TABLE chat_sessions ADD COLUMN last_activity_at TEXT
    CHECK (kind IS NULL OR last_activity_at IS NOT NULL)`,
  `ALTER TABLE chat_sessions ADD COLUMN unread INTEGER NOT NULL DEFAULT 0
    CHECK (unread IN (0, 1))`,
  // Set exactly when the thread is resolved.
  `ALTER TABLE chat_sessions ADD COLUMN resolved_at TEXT
    CHECK ((resolved_at IS NOT NULL) = (state IS 'resolved'))`,

  `CREATE INDEX idx_chat_sessions_project_state ON chat_sessions(project_id, state)`,
  // One coordinator per project, so "restart coordinator" resets this row instead of adding one.
  `CREATE UNIQUE INDEX uq_chat_sessions_project_coordinator
    ON chat_sessions(project_id) WHERE kind = 'coordinator'`,
];
