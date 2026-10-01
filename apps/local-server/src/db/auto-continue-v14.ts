/**
 * Migration v14: whether a project's threads take up their work by themselves when a usage limit
 * resets. Versions 1 to 13 are never edited; a database that applied them only runs this.
 *
 * - projects.auto_continue: on (1) resumes a rate-limited thread at the reset, which is what every
 *   project did before the setting existed, so every existing project gets it on. Off (0) leaves
 *   the thread waiting past the reset until the person resumes it.
 */
export const AUTO_CONTINUE_V14_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN auto_continue INTEGER NOT NULL DEFAULT 1
    CHECK (auto_continue IN (0, 1))`,
];
