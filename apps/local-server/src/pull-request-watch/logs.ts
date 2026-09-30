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

// What the real `gh run view --log-failed` prints (recorded by the real-runtime harness): every
// line starts with "<job>\t<step>\t" and, except the continuation lines of a multi-line
// annotation, a timestamp; the first line also has a byte order mark; and GitHub writes colour
// codes as the text "^[[36;1m", not as the escape character. All of it is noise that would use
// up the room meant for the failure.
const BOM = String.fromCharCode(0xfeff);
// A line of gh output is "<job>\t<step>\t<text>"; a log of lines like that is gh's, and only then is the prefix cut.
const GH_LINE = /^[^\t]+\t[^\t]+\t/;
const GH_LINE_PREFIX = /^[^\t]*\t[^\t]*(?:\t|$)(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z ?)?/;
const CARET_ESCAPES = /\^\[\[[0-9;]*[A-Za-z]/g;

/** The last lines of a log, each cut short and the whole kept small, with colour codes and gh's line prefixes removed. */
export const tailOf = (log: string): string => {
  const lines = log
    .replace(ESCAPES, "")
    .replace(CARET_ESCAPES, "")
    .split("\n")
    .map((line) => line.replaceAll(BOM, ""));
  const fromGh = GH_LINE.test(lines.find((line) => line.trim() !== "") ?? "");
  const cleaned = lines
    .map((line) => (fromGh ? line.replace(GH_LINE_PREFIX, "") : line).trimEnd())
    .filter((line) => line !== "")
    .slice(-LINES_MAX)
    .map((line) => (line.length <= LINE_CHARS_MAX ? line : `${line.slice(0, LINE_CHARS_MAX)}…`));
  const kept: string[] = [];
  let size = 0;
  for (const line of cleaned.reverse()) {
    size += line.length + 1;
    if (size > LOG_CHARS_MAX) break;
    kept.unshift(line);
  }
  return kept.join("\n");
};
