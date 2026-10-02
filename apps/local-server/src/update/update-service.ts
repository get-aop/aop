import { isNewerBuild, type UpdateStatus } from "@aop/common";
import { getLogger } from "@aop/infra";
import { type FeedConfig, type FetchFn, fetchLatestRelease, messageOf } from "./release-feed.ts";
import {
  type CheckRecord,
  type OutcomeRecord,
  readCheckRecord,
  readOutcomeRecord,
  writeCheckRecord,
} from "./update-files.ts";

const logger = getLogger("update");

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000;
const DUE_POLL_MS = 60 * 60 * 1000;
/** AOP Nightly looks every hour, and while turns run it asks again every ten minutes. */
const NIGHTLY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const NIGHTLY_DUE_POLL_MS = 10 * 60 * 1000;
/** After a failed install, a nightly host does not try again on its own for this long. */
const AUTO_APPLY_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MANUAL_CHECK_COOLDOWN_MS = 30_000;
/** An update run that has written nothing after this long is treated as lost. */
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

export interface UpdateServiceDeps {
  /** The `update_check` setting. */
  isEnabled: () => Promise<boolean>;
  /** Whether this host is an installed build that can replace itself. */
  supported: boolean;
  /** The running release, `x.y.z`, or `dev`. */
  current: string;
  feed: FeedConfig;
  fetch?: FetchFn;
  /** Starts the update run in a process that outlives this host. */
  startUpdater: () => Promise<void>;
  now?: () => number;
  /** Where the update files live; the host's data folder unless a test says otherwise. */
  home?: string;
  /**
   * AOP Nightly installs a newer build by itself, never while a turn runs. Stable passes none:
   * a release is installed only when the owner asks.
   */
  autoApply?: AutoApply;
}

export interface AutoApply {
  /** The `update_auto_apply` setting. */
  enabled: () => Promise<boolean>;
  /** Some agent turn is running, so a restart now would land in the middle of it. */
  busy: () => Promise<boolean>;
}

export type ApplyResult = { ok: true } | { ok: false; error: string };

export interface UpdateService {
  status: () => Promise<UpdateStatus>;
  /** Looks at the feed now, at most every half minute however often it is asked. */
  check: () => Promise<UpdateStatus>;
  apply: () => Promise<ApplyResult>;
  /** Checks the feed if the last check is a day old (an hour for nightly) and the setting is on. */
  runDueCheck: () => Promise<void>;
  /** Nightly only: installs the build the last check saw when nothing is running. */
  runAutoApply: () => Promise<void>;
  /** Starts the once-a-day background check. */
  start: () => void;
  stop: () => void;
}

export const createUpdateService = (deps: UpdateServiceDeps): UpdateService => {
  const now = deps.now ?? Date.now;
  let record: CheckRecord | null | undefined;
  let checkError: string | null = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let applyingSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const loadRecord = async (): Promise<CheckRecord | null> => {
    if (record === undefined) record = await readCheckRecord(deps.home);
    return record;
  };

  const runCheck = async (): Promise<void> => {
    lastAttemptAt = now();
    try {
      const release = await fetchLatestRelease(deps.feed, deps.fetch);
      record = {
        checkedAt: new Date(now()).toISOString(),
        latest: release.version,
        releaseUrl: release.url,
      };
      checkError = null;
      await writeCheckRecord(record, deps.home).catch((error) =>
        logger.warn("Could not save the update check: {error}", { error: messageOf(error) }),
      );
    } catch (error) {
      checkError = messageOf(error);
      logger.warn("Update check failed: {error}", { error: checkError });
    }
  };

  const status = async (): Promise<UpdateStatus> => {
    const seen = await loadRecord();
    const progress = await applyProgress(deps.home, applyingSince, deps.current, now());
    if (progress.finished) applyingSince = null;
    return {
      enabled: await deps.isEnabled(),
      supported: deps.supported,
      current: deps.current,
      latest: seen?.latest ?? null,
      available: seen !== null && isNewerBuild(seen.latest, deps.current, deps.feed.channel),
      releaseUrl: seen?.releaseUrl ?? null,
      checkedAt: seen?.checkedAt ?? null,
      checkError,
      state: progress.state,
      updateError: progress.error,
    };
  };

  const check = async (): Promise<UpdateStatus> => {
    if (now() - lastAttemptAt >= MANUAL_CHECK_COOLDOWN_MS) await runCheck();
    return status();
  };

  const apply = async (): Promise<ApplyResult> => {
    if (!deps.supported) {
      return { ok: false, error: "This host runs from source and cannot update itself" };
    }
    if (applyingSince !== null) return { ok: false, error: "An update is already running" };
    await runCheck();
    const seen = await loadRecord();
    if (!seen || !isNewerBuild(seen.latest, deps.current, deps.feed.channel)) {
      return { ok: false, error: checkError ?? "AOP is already up to date" };
    }
    applyingSince = now();
    try {
      await deps.startUpdater();
    } catch (error) {
      applyingSince = null;
      return { ok: false, error: `Could not start the update: ${messageOf(error)}` };
    }
    return { ok: true };
  };

  const nightly = deps.feed.channel === "nightly";
  const checkInterval = nightly ? NIGHTLY_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
  const duePoll = nightly ? NIGHTLY_DUE_POLL_MS : DUE_POLL_MS;

  const runDueCheck = async (): Promise<void> => {
    const seen = await loadRecord();
    const due = !seen || now() - Date.parse(seen.checkedAt) >= checkInterval;
    if (due && (await deps.isEnabled())) await runCheck();
  };

  const runAutoApply = async (): Promise<void> => {
    const auto = deps.autoApply;
    if (!auto || !deps.supported || applyingSince !== null) return;
    const seen = await loadRecord();
    if (!seen || !isNewerBuild(seen.latest, deps.current, deps.feed.channel)) return;
    if (!(await deps.isEnabled()) || !(await auto.enabled())) return;
    if (await failedRecently(deps.home, deps.current, now())) return;
    if (await auto.busy()) {
      logger.info("AOP {version} is ready; installing it once no turn is running", {
        version: seen.latest,
      });
      return;
    }
    logger.info("Installing AOP {version} by itself (update_auto_apply)", {
      version: seen.latest,
    });
    const result = await apply();
    if (!result.ok) logger.warn("Automatic update did not start: {error}", { error: result.error });
  };

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runDueCheck()
        .then(runAutoApply)
        .catch((error) => logger.warn("Update check failed: {error}", { error: messageOf(error) }))
        .finally(() => schedule(duePoll));
    }, delayMs);
    timer.unref();
  };

  return {
    status,
    check,
    apply,
    runDueCheck,
    runAutoApply,
    start: () => schedule(FIRST_CHECK_DELAY_MS),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};

// A build that failed to start was rolled back; trying it again every hour would restart the
// host every hour for nothing. The owner can still install it with "Update now".
const failedRecently = async (
  home: string | undefined,
  current: string,
  nowMs: number,
): Promise<boolean> => {
  const outcome = await readOutcomeRecord(home);
  return (
    outcome !== null &&
    !outcome.ok &&
    outcome.from === current &&
    nowMs - Date.parse(outcome.at) < AUTO_APPLY_BACKOFF_MS
  );
};

interface Progress {
  state: UpdateStatus["state"];
  error: string | null;
  /** The run the host started has ended one way or the other. */
  finished: boolean;
}

// What the update run wrote says how it went; this host only knows it started one.
const applyProgress = async (
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
  // A failed run leaves this host running on the release it already had; say why.
  if (outcome && !outcome.ok && outcome.from === current) return fromOutcome(outcome);
  return { state: "idle", error: null, finished: false };
};

const fromOutcome = (outcome: OutcomeRecord): Progress =>
  outcome.ok
    ? { state: "updating", error: null, finished: false }
    : { state: "failed", error: outcome.error ?? "The update failed", finished: true };
