import { buildChannel, type PreviousUpdate, type UpdateStatus } from "@aop/common";
import { type OutcomeRecord, readOutcomeRecord } from "./update-files.ts";

/** An update run that has written nothing after this long is treated as lost. */
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;
/** After a failed install, the host does not try again on its own for this long. */
const AUTO_INSTALL_BACKOFF_MS = 6 * 60 * 60 * 1000;

export interface Progress {
  state: UpdateStatus["state"];
  error: string | null;
  /** The run the host started has ended one way or the other. */
  finished: boolean;
}

/**
 * Where the update stands, from what the update run wrote; this host only knows it started one.
 * After the run, a host still on the release it had shows a failure (it was rolled back) or, when
 * it was started by hand, that the new release is installed and needs a restart.
 */
export const applyProgress = async (
  home: string | undefined,
  applyingSince: number | null,
  current: string,
  nowMs: number,
): Promise<Progress> => {
  const outcome = await readOutcomeRecord(home);
  if (applyingSince !== null) {
    if (outcome && Date.parse(outcome.at) >= applyingSince) return fromOutcome(outcome);
    if (nowMs - applyingSince > APPLY_TIMEOUT_MS) {
      return { state: "failed", error: "The update did not finish", finished: true };
    }
    return { state: "updating", error: null, finished: false };
  }
  if (outcome && outcome.from === current && (!outcome.ok || outcome.restartNeeded)) {
    return fromOutcome(outcome);
  }
  return { state: "idle", error: null, finished: false };
};

// A queued update that could not start failed too, though no run ever wrote an outcome.
export const progressFields = (
  progress: Progress,
  startError: string | null,
): Pick<UpdateStatus, "state" | "updateError"> =>
  progress.state === "idle" && startError !== null
    ? { state: "failed", updateError: startError }
    : { state: progress.state, updateError: progress.error };

/** "Previous update" on the Updates page: the last run the updater recorded, or null. */
export const previousUpdate = async (home: string | undefined): Promise<PreviousUpdate | null> => {
  const outcome = await readOutcomeRecord(home);
  if (!outcome) return null;
  return {
    at: outcome.at,
    from: outcome.from,
    to: outcome.to,
    ok: outcome.ok,
    seconds: secondsOf(outcome),
    error: outcome.error,
  };
};

/**
 * Whether the host must not install `latest` by itself now. A build that failed to start was
 * rolled back, and trying it again every hour would restart the host every hour for nothing; one
 * installed on a host started by hand waits for that host's restart, and installing it again
 * would change nothing. A person can still install either with "Update host".
 */
export const autoInstallBlocked = async (
  home: string | undefined,
  current: string,
  latest: string,
  nowMs: number,
): Promise<boolean> => {
  const outcome = await readOutcomeRecord(home);
  if (!outcome || outcome.from !== current) return false;
  if (outcome.restartNeeded) return outcome.to === latest;
  return !outcome.ok && nowMs - Date.parse(outcome.at) < AUTO_INSTALL_BACKOFF_MS;
};

/** What a host started by hand must do once the new release is in place. */
export const restartNeededMessage = (version: string | null): string =>
  `Restart the host to use ${version ?? "the new release"}: stop \`${buildChannel().binaryName} run\` and start it again`;

const fromOutcome = (outcome: OutcomeRecord): Progress => {
  if (outcome.ok && outcome.restartNeeded) {
    return { state: "installed", error: restartNeededMessage(outcome.to), finished: true };
  }
  return outcome.ok
    ? { state: "updating", error: null, finished: false }
    : { state: "failed", error: outcome.error ?? "The update failed", finished: true };
};

const secondsOf = (outcome: OutcomeRecord): number | null => {
  if (!outcome.startedAt) return null;
  const ms = Date.parse(outcome.at) - Date.parse(outcome.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
};
