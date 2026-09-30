import type { CommandResult, RunGh } from "./run-gh.ts";

/** A `gh` read that never throws: what it returned, or why it could not, and whether GitHub is throttling. */
export type GhRead<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; rateLimited: boolean };

/** A watcher's read must not hold a slot for good when `gh` hangs. */
const READ_TIMEOUT_MS = 30_000;

const RATE_LIMIT_PATTERN = /rate limit|abuse detection|HTTP 429/i;

export const ghFailure = (
  message: string,
): { ok: false; message: string; rateLimited: boolean } => ({
  ok: false,
  message,
  rateLimited: RATE_LIMIT_PATTERN.test(message),
});

export type GhRun = { ran: true; result: CommandResult } | { ran: false; message: string };

/** Runs `gh` and turns a spawn error or a timeout into a value: a missing binary throws, and must not end a poll loop. */
export const attemptGh = async (runGh: RunGh, args: string[], cwd: string): Promise<GhRun> => {
  try {
    return { ran: true, result: await runGh(args, cwd, { timeoutMs: READ_TIMEOUT_MS }) };
  } catch (error) {
    return { ran: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** The output of a `gh` command that succeeded, else why it did not. */
export const readGhOutput = async (
  runGh: RunGh,
  args: string[],
  cwd: string,
): Promise<GhRead<string>> => {
  const run = await attemptGh(runGh, args, cwd);
  if (!run.ran) return ghFailure(run.message);
  const { result } = run;
  if (result.exitCode === 0) return { ok: true, value: result.stdout };
  return ghFailure(
    result.stderr.trim() || result.stdout.trim() || `gh exited with code ${result.exitCode}`,
  );
};
