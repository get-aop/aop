/**
 * Migration v10: the host's record of what the person did with each suggested thread. Versions
 * 1 to 9 are never edited; a database that applied them only runs these statements.
 *
 * - suggestion_answers: one row per answered suggestion, keyed by the coordinator message that
 *   proposed it and the suggestion's id in that message's block. A suggestion nobody answered
 *   has no row. `started` names the thread it became, and the primary key is what makes a start
 *   happen once: the row is written in the transaction that stores the thread, so two clients
 *   starting the same proposal end with one row and one thread. `skipped` names none.
 *   The row goes with the message, and with the thread a start made: a thread that is deleted,
 *   or that failed to start, leaves its proposal open again.
 */
export const SUGGESTION_ANSWERS_V10_STATEMENTS: readonly string[] = [
  `CREATE TABLE suggestion_answers (
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    suggestion_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'skipped')),
    thread_id TEXT UNIQUE REFERENCES chat_sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, suggestion_id),
    CHECK ((state = 'started') = (thread_id IS NOT NULL))
  )`,
];
