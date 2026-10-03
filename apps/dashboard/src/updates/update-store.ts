import { type ApplyUpdateRequest, normalizeReleaseVersion, type UpdateStatus } from "@aop/common";
import { useSyncExternalStore } from "react";
import { getHostVersion } from "../api/settings";
import { applyUpdate, cancelQueuedUpdate, checkForUpdate, getUpdateStatus } from "../api/updates";
import { rememberHostUpdated } from "./host-updated";

/**
 * The host's update as every surface (the Updates popover, AOP settings › Updates) shows it, in
 * one place so an update started from one is seen by the others. `target` is the release being
 * installed: from the moment the host says it is updating, whoever started it, the page waits for
 * the host to come back on that release.
 */
export interface UpdatesState {
  status: UpdateStatus | null;
  target: string | null;
  checking: boolean;
  /** A start, queue or cancel is on its way to the host. */
  sending: boolean;
  /** Why the last attempt to update or to wait for the host failed; null while all is well. */
  error: string | null;
}

export interface UpdateEnvironment {
  /** Called once the host answers on the new release. */
  onHostBack: () => void;
  /** How often the returning host is looked for, in milliseconds. */
  pollMs: number;
  /** How long to wait for the host before saying it did not come back. */
  giveUpMs: number;
}

const INITIAL: UpdatesState = {
  status: null,
  target: null,
  checking: false,
  sending: false,
  error: null,
};

// A browser got its dashboard from the old host, so it reloads; the desktop app's dashboard is
// bundled with the app, so it only has to read the host again.
const defaultEnvironment = (): UpdateEnvironment => ({
  onHostBack: () => {
    if (hasDesktopBridge()) void refreshUpdates();
    else window.location.reload();
  },
  pollMs: 1_500,
  giveUpMs: 3 * 60_000,
});

let state: UpdatesState = INITIAL;
let environment: UpdateEnvironment = defaultEnvironment();
let watchTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export const useUpdates = (): UpdatesState => useSyncExternalStore(subscribe, () => state);

/** Non-hook accessor (one-shot reads, tests). */
export const getUpdates = (): UpdatesState => state;

/**
 * Reads the host's update status. Silent on failure: a status that cannot load is just absent.
 * A host that says it is updating is followed until it is back, whichever device started it.
 */
export const refreshUpdates = async (): Promise<void> => {
  try {
    const status = await getUpdateStatus();
    publish({ status });
    if (status.state === "updating" && state.target === null && status.latest) {
      watchForHost(status.latest);
    }
  } catch {
    // A host that is unreachable or refuses to say has no update to show.
  }
};

export const checkForHostUpdate = async (): Promise<void> => {
  publish({ checking: true });
  try {
    publish({ status: await checkForUpdate(), checking: false });
  } catch (error) {
    publish({ checking: false, error: failureMessage(error, "Could not check for updates.") });
  }
};

/**
 * "Update host" (`now`), or "Update when they finish" (`idle`): the host queues it and keeps it,
 * so it happens even after this window is closed.
 */
export const startUpdate = async (when: ApplyUpdateRequest["when"] = "now"): Promise<void> => {
  const latest = state.status?.latest;
  if (!latest) return;
  publish({ error: null, sending: true });
  try {
    const { queued } = await applyUpdate(when);
    publish({ sending: false });
    if (queued) await refreshUpdates();
    else watchForHost(latest);
  } catch (error) {
    publish({ sending: false, error: failureMessage(error, "The update could not start.") });
  }
};

/** Drops an update queued for when the running turns finish. */
export const cancelQueued = async (): Promise<void> => {
  publish({ error: null, sending: true });
  try {
    await cancelQueuedUpdate();
  } catch (error) {
    publish({ error: failureMessage(error, "Could not cancel the update.") });
  }
  publish({ sending: false });
  await refreshUpdates();
};

/** Lets the person try again after a failed update. */
export const clearUpdateError = (): void => publish({ error: null });

/** Test seam: forget everything and use `next` in place of the real page and timings. */
export const resetUpdatesForTests = (next?: Partial<UpdateEnvironment>): void => {
  stopWatching();
  state = INITIAL;
  environment = { ...defaultEnvironment(), ...next };
  for (const listener of listeners) listener();
};

const watchForHost = (target: string): void => {
  stopWatching();
  publish({ target, error: null });
  const deadline = Date.now() + environment.giveUpMs;

  const poll = async (): Promise<void> => {
    const reported = await hostRelease();
    if (reported !== null && normalizeReleaseVersion(reported) === target) {
      hostCameBack(target);
      return;
    }
    // A host that answers on another release may be the old one after a rollback: it says so.
    if (reported !== null && (await updateFailed())) return;
    if (Date.now() >= deadline) {
      publish({ target: null, error: `The host did not come back on ${target}.` });
      return;
    }
    watchTimer = setTimeout(poll, environment.pollMs);
  };
  watchTimer = setTimeout(poll, environment.pollMs);
};

const hostCameBack = (version: string): void => {
  const { status } = state;
  rememberHostUpdated({
    version,
    hostName: status?.hostName ?? "",
    releaseUrl: status?.releaseUrl ?? null,
  });
  publish({ target: null });
  environment.onHostBack();
};

// The host is down for a while during the restart, so a failed probe just means "not yet".
const hostRelease = async (): Promise<string | null> => {
  try {
    return await getHostVersion();
  } catch {
    return null;
  }
};

// Shows the failure the host recorded and stops waiting for a release that is not coming.
const updateFailed = async (): Promise<boolean> => {
  try {
    const status = await getUpdateStatus();
    if (status.state !== "failed" && status.state !== "installed") return false;
    publish({ status, target: null, error: null });
    return true;
  } catch {
    return false;
  }
};

const stopWatching = (): void => {
  if (watchTimer !== null) clearTimeout(watchTimer);
  watchTimer = null;
};

const hasDesktopBridge = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { aopDesktop?: unknown }).aopDesktop);

const failureMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const publish = (patch: Partial<UpdatesState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
