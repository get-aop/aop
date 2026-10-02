/**
 * Migration v19: where a project's threads get computer and browser use from. Versions 1 to 18
 * are never edited; a database that applied them only runs this.
 *
 * - projects.computer_use: `model-default` adds nothing to a thread's runs, which is what every
 *   project did before the setting existed. `cua` gives threads CUA Driver's MCP tools. Only the
 *   options a project can hold today pass the check.
 */
export const COMPUTER_USE_V19_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN computer_use TEXT NOT NULL DEFAULT 'model-default'
    CHECK (computer_use IN ('model-default', 'cua'))`,
];
