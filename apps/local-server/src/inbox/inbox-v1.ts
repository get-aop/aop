/**
 * The Inbox database's first version.
 *
 * - `inbox_items`: the messages that matched the person's rules, one row per DM conversation,
 *   thread or lone channel message, unique per source and key.
 * - `inbox_links`: what the person linked an item to in AOP (a thread, a pull request, an issue).
 * - `inbox_threads`: ids only, no text: the threads the person started, replied in or was
 *   mentioned in, so a later reply in one counts as needing them.
 */
export const INBOX_V1_STATEMENTS: readonly string[] = [
  `CREATE TABLE inbox_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    conversation_name TEXT NOT NULL,
    conversation_kind TEXT NOT NULL,
    thread_id TEXT,
    message_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar_url TEXT,
    text TEXT NOT NULL,
    reason TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'unread',
    snoozed_until TEXT,
    permalink TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    expired INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, item_key)
  )`,
  "CREATE INDEX inbox_items_received ON inbox_items (received_at DESC, id DESC)",
  "CREATE INDEX inbox_items_message ON inbox_items (source_id, conversation_id, message_id)",
  `CREATE TABLE inbox_links (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inbox_items (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    project_id TEXT,
    title TEXT,
    url TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (item_id, kind, ref)
  )`,
  `CREATE TABLE inbox_threads (
    source_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    touched_at TEXT NOT NULL,
    PRIMARY KEY (source_id, conversation_id, thread_id)
  )`,
];
