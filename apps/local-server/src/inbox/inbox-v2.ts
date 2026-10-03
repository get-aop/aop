/**
 * The Inbox database's second version: what the Slack source and the Inbox page need.
 *
 * - `inbox_sources`: per connected account, the person's rules and notification choice, and the
 *   last message the feed saw, where a catch-up read after downtime starts.
 * - `inbox_links.post_back`: a dispatched thread's PR notes go to the Slack thread, as the person.
 *   `pr_noted` is how far the host got following the thread's pull request (`opened`, then
 *   `merged` or `closed`), so each note and the automatic PR link happen once.
 * - `inbox_sent`: ids only, of the replies the person sent from AOP, so the context marks them.
 */
export const INBOX_V2_STATEMENTS: readonly string[] = [
  `CREATE TABLE inbox_sources (
    source_id TEXT PRIMARY KEY,
    rules TEXT,
    notifications TEXT NOT NULL DEFAULT 'off',
    last_seen TEXT,
    updated_at TEXT NOT NULL
  )`,
  "ALTER TABLE inbox_links ADD COLUMN post_back INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE inbox_links ADD COLUMN pr_noted TEXT",
  `CREATE TABLE inbox_sent (
    source_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    item_id TEXT,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (source_id, conversation_id, message_id)
  )`,
];
