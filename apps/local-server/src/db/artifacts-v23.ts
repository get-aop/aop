/**
 * Migration v23: artifacts, on top of the Library (v22). Versions 1 to 22 are never edited.
 *
 * - library_artifacts: what makes a Library item an artifact: the title and kind its card and
 *   view show, the version that is current, and for a Visualize diagram the reply it was drawn
 *   from (`origin_message_id`, one diagram per reply) and the type it was drawn as.
 * - library_artifact_versions: every version, oldest first, each naming its content in the
 *   Library's blob store by `sha256`, and the turn that wrote it. The item's own sha256 and size
 *   follow the newest version, so the Library lists and serves the current file unchanged; the
 *   Library's blob accounting counts these rows, so an old version's file stays while its
 *   artifact does.
 */
export const ARTIFACTS_V23_STATEMENTS: readonly string[] = [
  `CREATE TABLE library_artifacts (
    item_id TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    kind TEXT NOT NULL,
    language TEXT,
    current_version INTEGER NOT NULL CHECK (current_version >= 1),
    origin_message_id TEXT,
    origin_type TEXT
  )`,
  `CREATE UNIQUE INDEX uq_library_artifacts_origin
    ON library_artifacts (origin_message_id) WHERE origin_message_id IS NOT NULL`,
  `CREATE TABLE library_artifact_versions (
    item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    size INTEGER NOT NULL CHECK (size >= 0),
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    note TEXT,
    session_id TEXT,
    message_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, version)
  )`,
  `CREATE INDEX idx_library_artifact_versions_blob ON library_artifact_versions (sha256)`,
];
