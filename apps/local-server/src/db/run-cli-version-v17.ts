/**
 * Migration v17: the agent CLI version each run ran on. Versions 1 to 16 are never edited; a
 * database that applied them only runs this statement.
 *
 * - chat_runs.cli_version: what the run's `system` init event named (Claude Code's
 *   `claude_code_version`), recorded when the run ends. Null on runs from before this version
 *   and on runs whose log never had an init event. An update of the CLI between turns shows up
 *   as the next run's version.
 */
export const RUN_CLI_VERSION_V17_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_runs ADD COLUMN cli_version TEXT`,
];
