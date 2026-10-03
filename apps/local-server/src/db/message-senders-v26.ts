/**
 * Migration v26: a thread chat names who sent each message. Versions 1 to 25 are never edited; a
 * database that applied them only runs these statements.
 *
 * Senders live in `chat_messages.origin_json` (chat-session/message-origin.ts); this marks what
 * older rows did not say:
 *
 * - A thread's first message, when the coordinator wrote it, is its brief: `brief: true`.
 * - A brief a routine's run wrote was stored as the coordinator's; it becomes the routine's, with
 *   the routine's words as the stored brief has them (after the line saying which run it is). A
 *   run whose routine was deleted is gone with it, so its thread keeps the coordinator's brief.
 */
export const MESSAGE_SENDERS_V26_STATEMENTS: readonly string[] = [
  `UPDATE chat_messages
    SET origin_json = json_set(origin_json, '$.brief', json('true'))
    WHERE json_extract(origin_json, '$.type') = 'coordinator-relay'
      AND id = (
        SELECT first.id FROM chat_messages AS first
        WHERE first.session_id = chat_messages.session_id
        ORDER BY first.turn_index, first.created_at, first.id
        LIMIT 1
      )`,
  `UPDATE chat_messages
    SET origin_json = (
      SELECT json_object(
        'type', 'routine',
        'routineId', routines.id,
        'name', routines.name,
        'prompt', CASE
          WHEN instr(chat_messages.content, char(10, 10)) > 0
            AND length(chat_messages.content) > instr(chat_messages.content, char(10, 10)) + 1
          THEN substr(chat_messages.content, instr(chat_messages.content, char(10, 10)) + 2)
          ELSE chat_messages.content
        END
      )
      FROM routine_runs JOIN routines ON routines.id = routine_runs.routine_id
      WHERE routine_runs.thread_id = chat_messages.session_id
      LIMIT 1
    )
    WHERE json_extract(origin_json, '$.type') = 'coordinator-relay'
      AND json_extract(origin_json, '$.brief') = 1
      AND chat_messages.content <> ''
      AND session_id IN (
        SELECT routine_runs.thread_id FROM routine_runs
        JOIN routines ON routines.id = routine_runs.routine_id
        WHERE routine_runs.thread_id IS NOT NULL
      )`,
];
