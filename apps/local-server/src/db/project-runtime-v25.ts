/**
 * Migration v25: a project names the runtime configuration each role runs on. Versions 1 to 24
 * are never edited; a database that applied them only runs this.
 *
 * - projects.coordinator_runtime_id and thread_runtime_id: an id of runtime_configuration_providers
 *   (AOP settings › Runtimes). Until now a role ran on the first configuration of its provider,
 *   which is the built-in Claude Code one (id `claude-code`, always first), so every existing
 *   project takes that id and runs exactly as before. There is no foreign key: SQLite cannot add
 *   one with a default, and the host refuses to remove a runtime a project names instead
 *   (runtime-configuration/service.ts), falling back to the host's default if one goes anyway.
 */
export const PROJECT_RUNTIME_V25_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN coordinator_runtime_id TEXT NOT NULL DEFAULT 'claude-code'`,
  `ALTER TABLE projects ADD COLUMN thread_runtime_id TEXT NOT NULL DEFAULT 'claude-code'`,
];
