/**
 * Migration v18: messages that reach a turn while it runs. Versions 1 to 17 are never edited; a
 * database that applied them only runs these statements.
 *
 * - chat_runs.input_path: the FIFO a running Claude Code run reads more user messages from, next
 *   to its log. Null on runs that take none (other runtimes, Windows, runs from before this
 *   version), whose messages wait for the turn to end as before.
 * - chat_messages.steered_run_id: the running run a user message was written into, mid-turn,
 *   instead of waiting to start a turn of its own. It counts as that run's, never as a queued
 *   turn. Cleared again when the run ended without taking it, which puts it back in line.
 */
export const STEER_DELIVERY_V18_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_runs ADD COLUMN input_path TEXT`,
  `ALTER TABLE chat_messages ADD COLUMN steered_run_id TEXT`,
  `CREATE INDEX idx_chat_messages_steered_run ON chat_messages(steered_run_id) WHERE steered_run_id IS NOT NULL`,
];
