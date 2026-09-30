import { normalizeReleaseVersion, type UpdateStatus } from "@aop/common";
import { useSyncExternalStore } from "react";
import { getHostVersion } from "../api/settings";
import { applyUpdate, checkForUpdate, getUpdateStatus } from "../api/updates";

/**
 * What every update surface (the notice bar, Settings About) shows, in one place so an update
 * started from one is seen by the other. `target` is the release being installed: from the
 * moment the owner starts it, the page waits for the host to come back on that release.
 */
export interface UpdatesState {
  status: UpdateStatus | null;
  target: string | null;
  checking: boolean;
  /** Why the last attempt to update or to wait for the host failed; null while all is well. */
  error: string | null;
}

export interface UpdateEnvironment {
  reload: () => void;
  /** How often the returning host is looked for, in milliseconds. */
  pollMs: number;
  /** How long to wait for the host before saying it did not come back. */
  giveUpMs: number;
}

const INITIAL: UpdatesState = { status: null, target: null, checking: false, error: null };

const defaultEnvironment = (): UpdateEnvironment => ({
  reload: () => window.location.reload(),
  pollMs: 1_500,
  giveUpMs: 3 * 60_000,
});

let state: UpdatesState = INITIAL;
let environment: UpdateEnvironment = defaultEnvironment();
let watchTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export const useUpdates = (): UpdatesState => useSyncExternalStore(subscribe, () => state);

/** Reads the host's update status. Silent on failure: a notice that cannot load is just absent. */
export const refreshUpdates = async (): Promise<void> => {
  try {
    const status = await getUpdateStatus();
    publish({ status });
    if (status.state === "updating" && state.target === null && status.latest) {
      watchForHost(status.latest);
    }
  } catch {
    // A host that is unreachable or refuses to say has no notice to show.
  }
};

export const checkForUpdates = async (): Promise<void> => {
  publish({ checking: true });
  try {
    publish({ status: await checkForUpdate(), checking: false });
  } catch {
    publish({ checking: false });
  }
};

/** Starts the update and waits for the host to come back on the new release, then reloads. */
export const startUpdate = async (): Promise<void> => {
  const latest = state.status?.latest;
  if (!latest) return;
  publish({ error: null, target: latest });
  try {
    await applyUpdate();
  } catch (error) {
    publish({ target: null, error: failureMessage(error) });
    return;
  }
  watchForHost(latest);
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
      environment.reload();
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
    if (status.state !== "failed") return false;
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

const failureMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "The update could not start.";

const publish = (patch: Partial<UpdatesState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
