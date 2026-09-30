/**
 * Migration v9: a chat session may run on the CLI's own default model or effort. Versions 1 to 8
 * are never edited; a database that applied them only runs these statements.
 *
 * - chat_sessions.model and reasoning_effort become nullable. Null is "use default": AOP passes
 *   no `--model` or `--effort` and the CLI decides. SQLite cannot drop a NOT NULL in place, and
 *   the runner cannot rebuild chat_sessions (dropping the table would cascade into the messages
 *   and runs that reference it), so each column is copied to a nullable one, dropped, and the
 *   copy renamed to take its place. Neither column is in an index or a CHECK.
 * - Until now a role on "Use default" was resolved when a session started and stored as the
 *   catalog's model and a concrete effort, so it passed flags its project never chose. The last
 *   statements clear them where the project's role is still on default. A coordinator is kept in
 *   step with its project, so that is exact for it; a thread records what its project asked
 *   when it started, and one whose project has since moved from a model to default follows the
 *   default from here on.
 */
const ROLES = [
  { kind: "coordinator", model: "coordinator_model", effort: "coordinator_effort" },
  { kind: "thread", model: "thread_model", effort: "thread_effort" },
] as const;

const clearWhereProjectIsOnDefault = (column: string, projectColumn: string, kind: string) =>
  `UPDATE chat_sessions SET ${column} = NULL
    WHERE kind = '${kind}'
      AND project_id IN (SELECT id FROM projects WHERE ${projectColumn} IS NULL)`;

export const DEFAULT_RUNTIME_V9_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_sessions ADD COLUMN model_next TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN reasoning_effort_next TEXT`,
  `UPDATE chat_sessions SET model_next = model, reasoning_effort_next = reasoning_effort`,
  `ALTER TABLE chat_sessions DROP COLUMN model`,
  `ALTER TABLE chat_sessions DROP COLUMN reasoning_effort`,
  `ALTER TABLE chat_sessions RENAME COLUMN model_next TO model`,
  `ALTER TABLE chat_sessions RENAME COLUMN reasoning_effort_next TO reasoning_effort`,
  ...ROLES.flatMap(({ kind, model, effort }) => [
    clearWhereProjectIsOnDefault("model", model, kind),
    clearWhereProjectIsOnDefault("reasoning_effort", effort, kind),
  ]),
];
