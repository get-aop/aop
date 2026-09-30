/**
 * Migration v5: what run scheduling needs on top of the coordinator tables. Versions 1 to 4 are
 * never edited; a database that applied them only runs these statements.
 *
 * - chat_sessions.resumes_at: when a session waiting on a rate or usage limit resumes by itself.
 *   It is the durable half of the resume timer: the timer lives in memory and is re-armed from
 *   this column at boot, so a restart neither loses a wait nor forgets one that has come due.
 *   A thread has it exactly while its state is `rate-limited`, and the wire type carries it
 *   there. A coordinator has no state, so it may hold it at any time; a session outside any
 *   project never does.
 *
 * The concurrency cap needs no column: the number of running thread turns is counted from
 * chat_runs, and a queued turn is a user message that has no run yet, which is already durable.
 */
export const SCHEDULING_V5_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_sessions ADD COLUMN resumes_at TEXT
    CHECK ((state IS 'rate-limited') = (resumes_at IS NOT NULL) OR kind IS 'coordinator')`,
];
