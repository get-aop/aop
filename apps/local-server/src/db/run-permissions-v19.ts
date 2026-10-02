/**
 * Migration v19: whether each run skipped the CLI's permission checks. Versions 1 to 18 are
 * never edited; a database that applied them only runs this statement.
 *
 * - chat_runs.permissions_bypassed: 1 when the run was launched with a permission-skipping flag
 *   (Claude Code's `--dangerously-skip-permissions`: a thread with full access, or any session
 *   while the host's "skip permission checks" setting was on), 0 when it was not. Recorded right
 *   before the CLI starts, next to `cli_version`. Null on runs from before this version.
 */
export const RUN_PERMISSIONS_V19_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_runs ADD COLUMN permissions_bypassed INTEGER`,
];
