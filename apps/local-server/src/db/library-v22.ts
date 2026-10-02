/**
 * Migration v22: the project Library. Versions 1 to 21 are never edited; a database that applied
 * them only runs this.
 *
 * - library_items: one row per file the Library shows. `sha256` names the stored file: artifacts
 *   and uploads live once per content under the project's `library/blobs/`, so two items with the
 *   same bytes share it. A `chat` item is the attachment its message already holds
 *   (`session_id`, `message_id`, `attachment_file`), indexed where it is.
 *   `added_at` starts the retention clock (an attachment indexed after the fact gets a full
 *   period); `removed_at` and `removed_reason` keep a chat item after its file is gone, so the
 *   message can say the file expired instead of failing to load.
 * - library_settings: a project's own retention choices; a null column takes the host's default.
 */
export const LIBRARY_V22_STATEMENTS: readonly string[] = [
  `CREATE TABLE library_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('artifact', 'chat', 'upload')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    folder TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    session_id TEXT,
    message_id TEXT,
    attachment_file TEXT,
    created_at TEXT NOT NULL,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    removed_at TEXT,
    removed_reason TEXT CHECK (removed_reason IS NULL OR removed_reason IN ('expired', 'deleted')),
    CHECK ((removed_at IS NULL) = (removed_reason IS NULL)),
    CHECK (removed_at IS NULL OR source = 'chat'),
    CHECK ((source = 'chat') = (attachment_file IS NOT NULL AND message_id IS NOT NULL))
  )`,
  `CREATE INDEX idx_library_items_project ON library_items (project_id, removed_at)`,
  `CREATE INDEX idx_library_items_blob ON library_items (project_id, sha256)`,
  `CREATE UNIQUE INDEX uq_library_items_chat_file
    ON library_items (session_id, attachment_file) WHERE attachment_file IS NOT NULL`,
  `CREATE TABLE library_settings (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    retention_days INTEGER CHECK (retention_days IS NULL OR retention_days >= 0),
    cap_mb INTEGER CHECK (cap_mb IS NULL OR cap_mb >= 0)
  )`,
];
