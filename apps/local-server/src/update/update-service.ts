import {
  type ApplyUpdateRequest,
  type HostManagement,
  type HostRestart,
  isNewerBuild,
  type UpdateStatus,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import { callerMayManage, type HostCaller } from "../auth/host-management.ts";
import { createUpdateQueue, type RunningTurnRef } from "./queued-update.ts";
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
/** How often a queued update looks whether the turns it waits for have finished. */
const QUEUE_POLL_MS = 15_000;

export interface UpdateServiceDeps {
  /** The `update_check` setting. */
  isEnabled: () => Promise<boolean>;
  /** Why this host cannot replace itself (install-layout.ts selfUpdateRefusal), or null when it can. */
  unsupported: string | null;
  /** The running release, `x.y.z`, or `dev`. */
  current: string;
  feed: FeedConfig;
  fetch?: FetchFn;
  /** Starts the update run in a process that outlives this host. */
  startUpdater: () => Promise<void>;
  /** The host's name, as people call it. */
  hostName: string;
  /** How the host is kept running, which decides what an update does. */
  restart: () => Promise<HostRestart>;
  /** The turns running now (threads, coordinators, chats), which a restart would land in. */
  runningTurns: () => Promise<RunningTurnRef[]>;
  /** The `host_management` setting: who may update the host. */
  hostManagement: () => Promise<HostManagement>;
  now?: () => number;
  /** Where the update files live; the host's data folder unless a test says otherwise. */
  home?: string;
  /**
   * AOP Nightly installs a newer build by itself, once the turns running when it found it have
   * finished. Stable passes none: a release is installed only when a person asks.
   */
  autoApply?: AutoApply;
}

export interface AutoApply {
  /** The `update_auto_apply` setting. */
  enabled: () => Promise<boolean>;
}

/** `queued`: turns were running, so it starts once they finish (queued-update.ts). */
export type ApplyResult = { ok: true; queued: boolean } | { ok: false; error: string };

/** A caller that is not named (the host's own timers, tests) is the host machine. */
const HOST_ITSELF: HostCaller = { kind: "owner", agent: false };

export interface UpdateService {
  /** The host's release and what `caller` may do about it. */
  status: (caller?: HostCaller) => Promise<UpdateStatus>;
  /** Looks at the feed now, at most every half minute however often it is asked. */
  check: (caller?: HostCaller) => Promise<UpdateStatus>;
  /** Starts the update now, or (`when: "idle"`) once the turns running now have finished. */
  apply: (request?: Partial<ApplyUpdateRequest>) => Promise<ApplyResult>;
  /** Drops an update queued for later. */
  cancel: () => Promise<void>;
  /** Starts a queued update whose turns have finished. */
  runQueued: () => Promise<void>;
  /** Checks the feed if the last check is a day old (an hour for nightly) and the setting is on. */
  runDueCheck: () => Promise<void>;
  /** Nightly only: installs the build the last check saw, or queues it while turns run. */
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
  /** Why a queued update could not start; shown until the next attempt. */
  let startError: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queueTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const queue = createUpdateQueue(now);

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

  const status = async (caller: HostCaller = HOST_ITSELF): Promise<UpdateStatus> => {
    const seen = await loadRecord();
    const progress = await applyProgress(deps.home, applyingSince, deps.current, now());
    if (progress.finished) applyingSince = null;
    const running = await deps.runningTurns();
    return {
      enabled: await deps.isEnabled(),
      supported: deps.unsupported === null,
      current: deps.current,
      ...releaseFields(seen, deps),
      checkError,
      ...progressFields(progress, startError),
      hostName: deps.hostName,
      ...callerFields(await deps.hostManagement(), caller),
      restart: await deps.restart(),
      runningTurns: running.map(({ title, kind }) => ({ title, kind })),
      queued: applyingSince === null ? queue.view(running) : null,
      download: { state: "idle", version: null, error: null },
      previous: null,
      includes: { cuaDriver: null },
    };
  };

  const check = async (caller?: HostCaller): Promise<UpdateStatus> => {
    if (now() - lastAttemptAt >= MANUAL_CHECK_COOLDOWN_MS) await runCheck();
    return status(caller);
  };

  // The newer release this host may install now, after a fresh look at the feed; else why not.
  const installable = async (): Promise<{ version: string } | { error: string }> => {
    if (deps.unsupported !== null) return { error: deps.unsupported };
    if (applyingSince !== null) return { error: "An update is already running" };
    await runCheck();
    const seen = await loadRecord();
    if (!seen || !isNewerBuild(seen.latest, deps.current, deps.feed.channel)) {
      return { error: checkError ?? "AOP is already up to date" };
    }
    return { version: seen.latest };
  };

  const startNow = async (): Promise<ApplyResult> => {
    const target = await installable();
    if ("error" in target) return { ok: false, error: target.error };
    queue.cancel();
    startError = null;
    applyingSince = now();
    try {
      await deps.startUpdater();
    } catch (error) {
      applyingSince = null;
      return { ok: false, error: `Could not start the update: ${messageOf(error)}` };
    }
    return { ok: true, queued: false };
  };

  const enqueue = async (by: "person" | "auto"): Promise<ApplyResult> => {
    const target = await installable();
    if ("error" in target) return { ok: false, error: target.error };
    const running = await deps.runningTurns();
    if (running.length === 0) return startNow();
    startError = null;
    queue.queue(target.version, by, running);
    logger.info("AOP {version} installs once {count} running turns finish", {
      version: target.version,
      count: running.length,
    });
    scheduleQueue();
    return { ok: true, queued: true };
  };

  const apply = async (request: Partial<ApplyUpdateRequest> = {}): Promise<ApplyResult> =>
    request.when === "idle" ? enqueue("person") : startNow();

  const cancel = async (): Promise<void> => {
    queue.cancel();
    if (queueTimer) clearTimeout(queueTimer);
    queueTimer = null;
  };

  const runQueued = async (): Promise<void> => {
    if (queue.queuedBy() === "auto" && !(await autoApplyAllowed())) {
      await cancel();
      return;
    }
    const version = queue.due(await deps.runningTurns());
    if (!version) return;
    logger.info("The turns AOP {version} waited for have finished; installing it", { version });
    const result = await startNow();
    if (result.ok) return;
    await cancel();
    startError = result.error;
    logger.warn("Queued update did not start: {error}", { error: result.error });
  };

  const scheduleQueue = (): void => {
    if (stopped || queueTimer) return;
    queueTimer = setTimeout(() => {
      queueTimer = null;
      void runQueued()
        .catch((error) => logger.warn("Queued update failed: {error}", { error: messageOf(error) }))
        .finally(() => {
          if (queue.queuedBy() !== null) scheduleQueue();
        });
    }, QUEUE_POLL_MS);
    queueTimer.unref();
  };

  const nightly = deps.feed.channel === "nightly";
  const checkInterval = nightly ? NIGHTLY_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
  const duePoll = nightly ? NIGHTLY_DUE_POLL_MS : DUE_POLL_MS;

  const runDueCheck = async (): Promise<void> => {
    const seen = await loadRecord();
    const due = !seen || now() - Date.parse(seen.checkedAt) >= checkInterval;
    if (due && (await deps.isEnabled())) await runCheck();
  };

  const autoApplyAllowed = async (): Promise<boolean> =>
    deps.autoApply !== undefined &&
    (await deps.isEnabled()) &&
    (await deps.autoApply.enabled()) &&
    !(await failedRecently(deps.home, deps.current, now()));

  // The newer build the last check saw, when this host may install it by itself; else null.
  const autoApplyCandidate = async (): Promise<string | null> => {
    if (deps.unsupported !== null || applyingSince !== null || queue.queuedBy() !== null) {
      return null;
    }
    const seen = await loadRecord();
    if (!seen || !isNewerBuild(seen.latest, deps.current, deps.feed.channel)) return null;
    return (await autoApplyAllowed()) ? seen.latest : null;
  };

  // A busy host queues the install behind the turns running now, so a host that is never idle
  // still updates once they have finished.
  const runAutoApply = async (): Promise<void> => {
    const version = await autoApplyCandidate();
    if (!version) return;
    logger.info("Installing AOP {version} by itself (update_auto_apply)", { version });
    const result = await enqueue("auto");
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
    cancel,
    runQueued,
    runDueCheck,
    runAutoApply,
    start: () => schedule(FIRST_CHECK_DELAY_MS),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (queueTimer) clearTimeout(queueTimer);
    },
  };
};

// A build that failed to start was rolled back; trying it again every hour would restart the
// host every hour for nothing. A person can still install it with "Update host".
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

const releaseFields = (seen: CheckRecord | null, deps: UpdateServiceDeps) => ({
  latest: seen?.latest ?? null,
  available: seen !== null && isNewerBuild(seen.latest, deps.current, deps.feed.channel),
  releaseUrl: seen?.releaseUrl ?? null,
  checkedAt: seen?.checkedAt ?? null,
});

// A queued update that could not start failed too, though no run ever wrote an outcome.
const progressFields = (
  progress: Progress,
  startError: string | null,
): Pick<UpdateStatus, "state" | "updateError"> =>
  progress.state === "idle" && startError !== null
    ? { state: "failed", updateError: startError }
    : { state: progress.state, updateError: progress.error };

const callerFields = (
  hostManagement: HostManagement,
  caller: HostCaller,
): Pick<UpdateStatus, "canUpdate" | "owner" | "hostManagement"> => ({
  canUpdate: callerMayManage(hostManagement, caller),
  owner: caller.kind === "owner" && !caller.agent,
  hostManagement,
});

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
