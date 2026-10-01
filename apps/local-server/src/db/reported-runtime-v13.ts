/**
 * Migration v13: what each role of a project last ran on when it ran on "Use default". Versions
 * 1 to 12 are never edited; a database that applied them only runs these statements.
 *
 * - projects.coordinator_reported_model / _effort and thread_reported_model / _effort: read from
 *   the log of the role's last run launched without `--model` (or without `--effort`), so the
 *   settings can say "Default (Opus 5.5)". Null until such a run reports one. Neither is a
 *   setting: editing the project never writes them, and no CHECK lists the values, since the
 *   model is the CLI's own id and the effort is validated where it is read.
 */
export const REPORTED_RUNTIME_V13_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN coordinator_reported_model TEXT`,
  `ALTER TABLE projects ADD COLUMN coordinator_reported_effort TEXT`,
  `ALTER TABLE projects ADD COLUMN thread_reported_model TEXT`,
  `ALTER TABLE projects ADD COLUMN thread_reported_effort TEXT`,
];
