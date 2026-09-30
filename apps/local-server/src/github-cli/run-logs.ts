import { type GhRead, readGhOutput } from "./read.ts";
import type { RunGh } from "./run-gh.ts";

/** The Actions run a check belongs to, named in its link (`.../actions/runs/<id>/job/<job>`); null for a check that is not one. */
export const actionsRunIdOf = (link: string): string | null =>
  /\/actions\/runs\/(\d+)/.exec(link)?.[1] ?? null;

/** What the steps that failed in an Actions run printed, as `gh run view --log-failed` gives it. */
export const readFailedRunLog = (
  runGh: RunGh,
  repoPath: string,
  runId: string,
): Promise<GhRead<string>> => readGhOutput(runGh, ["run", "view", runId, "--log-failed"], repoPath);
