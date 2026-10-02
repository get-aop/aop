/**
 * Migration v21: what a working thread needs the person to know while its turn goes on. Versions
 * 1 to 20 are never edited; a database that applied them only runs this.
 *
 * - chat_sessions.waiting_on_json: JSON `ThreadWait`, set by the thread itself when it waits on the
 *   person for something outside AOP (an approval, a login, a secret) and keeps working.
 * - chat_sessions.tools_degraded_json: JSON `ThreadDegraded`, set by the host when the thread's AOP
 *   tools stopped reaching it.
 *
 * Both belong to a running turn, so only a `working` thread holds them.
 */
export const THREAD_ATTENTION_V21_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_sessions ADD COLUMN waiting_on_json TEXT
    CHECK (waiting_on_json IS NULL
      OR (state IS 'working' AND json_type(waiting_on_json) = 'object'))`,
  `ALTER TABLE chat_sessions ADD COLUMN tools_degraded_json TEXT
    CHECK (tools_degraded_json IS NULL
      OR (state IS 'working' AND json_type(tools_degraded_json) = 'object'))`,
];
