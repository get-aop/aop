/**
 * Migration v4: what the coordinator and thread backend needs on top of the Projects tables.
 * Versions 1 and 2 are never edited; a database that applied them only runs these statements.
 *
 * - projects.thread_access: whether a project's threads may run any command. The person opts
 *   in per project; the default is the safer mode. A ThreadAccess, typed in @aop/common.
 * - chat_runs.blocks_json: the message blocks a run's tools produced (a thread card for a
 *   spawned thread, a routing receipt, suggested threads). The run owns them until its
 *   assistant message exists, and the message is [its text, ...these blocks].
 * - chat_messages.origin_json: set on a message the server or the coordinator wrote into a
 *   session instead of the person: a thread report in the coordinator chat, or the brief the
 *   coordinator relays into a thread. Null on what a person typed. Its shape is a
 *   discriminated union on `type`, validated where it is read and written (message-origin.ts),
 *   so a new kind of synthetic message needs no new migration.
 * - DROP chat_delegation_runs: `$DELEGATE` specialists are replaced by threads, so nothing
 *   writes or reads the table any more.
 */
export const COORDINATOR_V4_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN thread_access TEXT NOT NULL DEFAULT 'auto-accept-edits'`,

  `ALTER TABLE chat_runs ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(blocks_json) AND json_type(blocks_json) = 'array')`,

  `ALTER TABLE chat_messages ADD COLUMN origin_json TEXT
    CHECK (origin_json IS NULL OR (json_valid(origin_json) AND json_type(origin_json, '$.type') IS 'text'))`,

  `DROP TABLE chat_delegation_runs`,
];
