import {
  type ApplyUpdateRequest,
  CUA_DRIVER_VERSION,
  type HostManagement,
  type HostRestart,
  isNewerBuild,
  type UpdateDownload,
  type UpdateLog,
  type UpdateStatus,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import { callerMayManage, type HostCaller } from "../auth/host-management.ts";
import type { ReleaseStager } from "./background-download.ts";
import { type InstallPolicy, installsByItselfAt, localMinuteOfDay } from "./install-policy.ts";
import { createUpdateQueue, type RunningTurnRef } from "./queued-update.ts";
import { type FeedConfig, type FetchFn, fetchLatestRelease, messageOf } from "./release-feed.ts";
import { type CheckRecord, readCheckRecord, writeCheckRecord } from "./update-files.ts";
import { readUpdateLog } from "./update-log.ts";
import {
  applyProgress,
  autoInstallBlocked,
  previousUpdate,
  progressFields,
} from "./update-progress.ts";

const logger = getLogger("update");

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000;
const DUE_POLL_MS = 60 * 60 * 1000;
/** AOP Nightly looks every hour, and while turns run it asks again every ten minutes. */
const NIGHTLY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const NIGHTLY_DUE_POLL_MS = 10 * 60 * 1000;
const MANUAL_CHECK_COOLDOWN_MS = 30_000;
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
  /**
   * The `update_install` settings, on either channel: "ask" leaves it to a person; "idle" queues
   * a newer release behind the turns running when it is seen; "window" does that only inside the
   * window hours.
   */
  installPolicy: () => Promise<InstallPolicy>;
  /** Releases downloaded ahead of time; none on a host that cannot replace itself. */
  download?: BackgroundDownload;
  now?: () => number;
  /** The minute of the day on the host's clock, which the window hours are in. */
  minuteOfDay?: (ms: number) => number;
  /** Where the update files live; the host's data folder unless a test says otherwise. */
  home?: string;
  /** The updater's log (`<data dir>/logs/update.log` unless a test says otherwise). */
  logFile?: string;
  /** The CUA Driver version this release pins; `CUA_DRIVER_VERSION` unless a test says otherwise. */
  cuaDriverPin?: string;
}

export interface BackgroundDownload {
  /** The `update_background_download` setting. */
  enabled: () => Promise<boolean>;
  stager: ReleaseStager;
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
  /** Stages the newer release the last check saw, when background download is on. */
  runBackgroundDownload: () => Promise<void>;
  /** Queues the newer release the last check saw, when the install policy says the host may. */
  runAutoInstall: () => Promise<void>;
  /** The end of the updater's log, for "Show log". */
  log: () => Promise<UpdateLog>;
  /** Starts the background check. */
  start: () => void;
  stop: () => void;
}

export const createUpdateService = (deps: UpdateServiceDeps): UpdateService => {
  const now = deps.now ?? Date.now;
  const minuteOfDay = deps.minuteOfDay ?? localMinuteOfDay;
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

  // The newer release the last check saw, or null when there is none.
  const newerSeen = async (): Promise<string | null> => {
    const seen = await loadRecord();
    return seen && isNewerBuild(seen.latest, deps.current, deps.feed.channel) ? seen.latest : null;
  };

  const runCheck = async (): Promise<void> => {
    lastAttemptAt = now();
    try {
      const release = await fetchLatestRelease(deps.feed, deps.fetch);
      record = {
        checkedAt: new Date(now()).toISOString(),
        latest: release.version,
        releaseUrl: release.url,
        ...(release.cuaDriver ? { cuaDriver: release.cuaDriver } : {}),
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

  const downloadView = async (): Promise<UpdateDownload> =>
    deps.download
      ? deps.download.stager.view(await newerSeen())
      : { state: "idle", version: null, error: null };

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
      download: await downloadView(),
      previous: await previousUpdate(deps.home),
      includes: { cuaDriver: cuaDriverChange(seen, deps) },
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
    const version = await newerSeen();
    return version ? { version } : { error: checkError ?? "AOP is already up to date" };
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

  // Whether the install policy lets the host install by itself right now.
  const policyAllowsNow = async (): Promise<boolean> =>
    (await deps.isEnabled()) && installsByItselfAt(await deps.installPolicy(), minuteOfDay(now()));

  // An install the host queued by itself stops waiting once the policy no longer allows it now
  // (switched to "ask", or the window closed); a later run of the policy queues it again.
  const runQueued = async (): Promise<void> => {
    if (queue.queuedBy() === "auto" && !(await policyAllowsNow())) {
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

  // A release installed on a host started by hand stays staged until that host restarts on it.
  const runBackgroundDownload = async (): Promise<void> => {
    if (!deps.download || deps.unsupported !== null) return;
    const version = await newerSeen();
    if (!version) return deps.download.stager.prune(null);
    if ((await deps.isEnabled()) && (await deps.download.enabled())) {
      await deps.download.stager.stage(version);
    }
  };

  // The newer build the last check saw, when this host may install it by itself now; else null.
  const autoInstallCandidate = async (): Promise<string | null> => {
    if (deps.unsupported !== null || applyingSince !== null || queue.queuedBy() !== null) {
      return null;
    }
    const version = await newerSeen();
    if (!version || !(await policyAllowsNow())) return null;
    return (await autoInstallBlocked(deps.home, deps.current, version, now())) ? null : version;
  };

  // A busy host queues the install behind the turns running now, so a host that is never idle
  // still updates once they have finished.
  const runAutoInstall = async (): Promise<void> => {
    const version = await autoInstallCandidate();
    if (!version) return;
    logger.info("Installing AOP {version} by itself (update_install)", { version });
    const result = await enqueue("auto");
    if (!result.ok) logger.warn("Automatic update did not start: {error}", { error: result.error });
  };

  // Downloading first lets an install that starts at once use the staged release.
  const tick = async (): Promise<void> => {
    await runDueCheck();
    await runBackgroundDownload();
    await runAutoInstall();
  };

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick()
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
    runBackgroundDownload,
    runAutoInstall,
    log: () => readUpdateLog(deps.logFile),
    start: () => schedule(FIRST_CHECK_DELAY_MS),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (queueTimer) clearTimeout(queueTimer);
    },
  };
};

const releaseFields = (seen: CheckRecord | null, deps: UpdateServiceDeps) => ({
  latest: seen?.latest ?? null,
  available: seen !== null && isNewerBuild(seen.latest, deps.current, deps.feed.channel),
  releaseUrl: seen?.releaseUrl ?? null,
  checkedAt: seen?.checkedAt ?? null,
});

// "Includes CUA Driver 0.32.0 → 0.33.0": only when the newer release pins another driver, and
// only when its feed says which (feeds before the field, and GitHub, do not).
const cuaDriverChange = (
  seen: CheckRecord | null,
  deps: UpdateServiceDeps,
): UpdateStatus["includes"]["cuaDriver"] => {
  const pin = deps.cuaDriverPin ?? CUA_DRIVER_VERSION;
  if (!seen?.cuaDriver || seen.cuaDriver === pin) return null;
  if (!isNewerBuild(seen.latest, deps.current, deps.feed.channel)) return null;
  return { from: pin, to: seen.cuaDriver };
};

const callerFields = (
  hostManagement: HostManagement,
  caller: HostCaller,
): Pick<UpdateStatus, "canUpdate" | "owner" | "hostManagement"> => ({
  canUpdate: callerMayManage(hostManagement, caller),
  owner: caller.kind === "owner" && !caller.agent,
  hostManagement,
});
