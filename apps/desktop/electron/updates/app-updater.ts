import type { AppUpdateState } from "../../src/backend/types";
import type { FetchLike } from "../connection/host-client";
import type { Logger } from "../log";
import { checkForNewerRelease } from "./feed-check";
import type { UpdateMode } from "./update-policy";

/** The part of electron-updater the app uses, so the rules are tested without the network. */
export interface AutoUpdaterPort {
  listen: (handlers: {
    available: (version: string) => void;
    progress: (percent: number) => void;
    downloaded: (version: string) => void;
    failed: (message: string) => void;
  }) => void;
  check: () => Promise<void>;
  quitAndInstall: () => void;
}

export interface AppUpdaterDeps {
  mode: UpdateMode;
  appVersion: string;
  arch: string;
  /** `AOP_RELEASE_FEED_URL`. */
  feedOrigin?: string;
  fetch: FetchLike;
  /** Builds electron-updater's adapter. Called only in `auto` mode, so `notice` never loads it. */
  createAutoUpdater: (feedOrigin?: string) => AutoUpdaterPort;
  /** Runs `run` after `delayMs` and returns what cancels it. */
  schedule: (run: () => void, delayMs: number) => () => void;
  onChange: (state: AppUpdateState) => void;
  log: Logger;
  intervalMs?: number;
}

export interface AppUpdater {
  state: () => AppUpdateState;
  /** Looks now and again every few hours. Does nothing when updates are off. */
  start: () => void;
  stop: () => void;
  /** Where the new version's download is, for the `notice` mode; null when there is none to open. */
  downloadUrl: () => string | null;
  /** Installs a downloaded update and restarts. Does nothing before one is ready. */
  restartToUpdate: () => void;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the app current. In `auto` mode electron-updater downloads a release in the background
 * and installs it when the app restarts (Windows). In `notice` mode the app only looks at the
 * published release and says a newer one exists, with a link, because the macOS app is not
 * signed yet and Squirrel.Mac would refuse to install it. A failed look is logged, never shown.
 */
export const createAppUpdater = (deps: AppUpdaterDeps): AppUpdater => {
  let state: AppUpdateState = { status: "idle" };
  let download: string | null = null;
  let cancelNext: (() => void) | null = null;
  let stopped = false;
  let autoUpdater: AutoUpdaterPort | null = null;

  const set = (next: AppUpdateState): void => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    deps.log(
      "update",
      next.status === "available" ? { ...next, downloadUrl: download } : { ...next },
    );
    deps.onChange(next);
  };

  const lookForNotice = async (): Promise<void> => {
    const newer = await checkForNewerRelease({
      fetch: deps.fetch,
      appVersion: deps.appVersion,
      arch: deps.arch,
      feedOrigin: deps.feedOrigin,
    });
    download = newer?.downloadUrl ?? newer?.releaseUrl ?? null;
    set(
      newer
        ? { status: "available", version: newer.version, releaseUrl: newer.releaseUrl }
        : { status: "idle" },
    );
  };

  const look = async (): Promise<void> => {
    try {
      if (deps.mode === "notice") await lookForNotice();
      else await autoUpdater?.check();
    } catch (error) {
      deps.log("update check failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!stopped)
        cancelNext = deps.schedule(() => void look(), deps.intervalMs ?? CHECK_INTERVAL_MS);
    }
  };

  const listen = (port: AutoUpdaterPort): void =>
    port.listen({
      available: (version) => set({ status: "downloading", version, percent: 0 }),
      progress: (percent) => {
        if (state.status === "downloading") set({ ...state, percent: Math.round(percent) });
      },
      downloaded: (version) => set({ status: "ready", version }),
      failed: (message) => deps.log("update failed", { message }),
    });

  return {
    state: () => state,
    start: () => {
      if (deps.mode === "off") return;
      if (deps.mode === "auto") {
        autoUpdater = deps.createAutoUpdater(deps.feedOrigin);
        listen(autoUpdater);
      }
      void look();
    },
    stop: () => {
      stopped = true;
      cancelNext?.();
    },
    downloadUrl: () => (state.status === "available" ? download : null),
    restartToUpdate: () => {
      if (state.status === "ready") autoUpdater?.quitAndInstall();
    },
  };
};
