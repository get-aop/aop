import {
  actionsRunIdOf,
  type GhPullRequestCheck,
  type RunGh,
  readFailedRunLog,
} from "../github-cli/index.ts";

const RUNS_MAX = 3;
const LINES_MAX = 60;
const LINE_CHARS_MAX = 300;
const LOG_CHARS_MAX = 2_500;
// Colour codes and the like: they are noise to an agent, and a stray one can garble a terminal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const ESCAPES = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * The end of what the failed steps of each failing check's run printed, by run id: what an agent
 * that may not run commands needs to see why the checks fail. Best effort: a run whose log cannot
 * be read is left out, and the prompt still names its link. Checks of one run share its log.
 */
export const failureLogs = async (
  runGh: RunGh,
  repoPath: string,
  checks: readonly GhPullRequestCheck[],
): Promise<Record<string, string>> => {
  const runIds = [...new Set(checks.flatMap((check) => actionsRunIdOf(check.link) ?? []))].slice(
    0,
    RUNS_MAX,
  );
  const logs: Record<string, string> = {};
  for (const runId of runIds) {
    const read = await readFailedRunLog(runGh, repoPath, runId);
    const tail = read.ok ? tailOf(read.value) : "";
    if (tail) logs[runId] = tail;
  }
  return logs;
};

/** The last lines of a log, each cut short and the whole kept small, with the colour codes removed. */
export const tailOf = (log: string): string => {
  const lines = log
    .replace(ESCAPES, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-LINES_MAX)
    .map((line) => (line.length <= LINE_CHARS_MAX ? line : `${line.slice(0, LINE_CHARS_MAX)}…`));
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.reverse()) {
    size += line.length + 1;
    if (size > LOG_CHARS_MAX) break;
    kept.unshift(line);
  }
  return kept.join("\n");
};
