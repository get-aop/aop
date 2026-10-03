import { type AppUpdateState, buildChannel, releaseNotesUrl } from "@aop/common";
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
  /** Whether a found release downloads by itself (`autoUpdater.autoDownload`). */
  setAutoDownload: (enabled: boolean) => void;
  check: () => Promise<void>;
  /** Downloads the release the last check found; for when automatic download is off. */
  download: () => Promise<void>;
  quitAndInstall: () => void;
}

export interface AppUpdaterDeps {
  mode: UpdateMode;
  appVersion: string;
  arch: string;
  /** desktop-config `autoDownloadUpdates`. */
  autoDownload: boolean;
  /** `AOP_RELEASE_FEED_URL`. */
  feedOrigin?: string;
  fetch: FetchLike;
  /** Builds electron-updater's adapter. Called only in `auto` mode, so `notice` never loads it. */
  createAutoUpdater: (feedOrigin?: string) => AutoUpdaterPort;
  /** Runs `run` after `delayMs` and returns what cancels it. */
  schedule: (run: () => void, delayMs: number) => () => void;
  onChange: (state: AppUpdateState) => void;
  log: Logger;
  now?: () => Date;
  intervalMs?: number;
}

export interface AppUpdater {
  state: () => AppUpdateState;
  /** Looks now and again every few hours. Does nothing when updates are off. */
  start: () => void;
  stop: () => void;
  /** The person asked to look now ("Check for updates"); resolves with the state it ends in. */
  check: () => Promise<AppUpdateState>;
  /** Where the new version's download is, for the `notice` mode; null when there is none to open. */
  downloadUrl: () => string | null;
  /** Installs a downloaded update and restarts. Does nothing before one is ready. */
  restartToUpdate: () => void;
  /** With automatic download off: downloads the release found, then restarts onto it. */
  downloadAndRestart: () => Promise<void>;
  setAutoDownload: (enabled: boolean) => void;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the app current. In `auto` mode electron-updater downloads a release in the background
 * (or, with automatic download off, when the person says so) and installs it when the app
 * restarts: Windows, and a Developer ID signed macOS app. In `notice` mode the app only looks
 * at the published release and says a newer one exists, with a link, because Squirrel.Mac
 * refuses to install over an unsigned app.
 *
 * What fails is shown as `error`: a check the person asked for, and any download. A background
 * check that fails (a laptop offline) is only logged, so the Updates button does not light up
 * for something nobody can act on; the next check tries again.
 */
export const createAppUpdater = (deps: AppUpdaterDeps): AppUpdater => {
  let state: AppUpdateState =
    deps.mode === "off" ? { status: "off" } : { status: "idle", checkedAt: null };
  let download: string | null = null;
  let cancelNext: (() => void) | null = null;
  let stopped = false;
  let autoDownload = deps.autoDownload;
  let restartWhenReady = false;
  // Whether electron-updater announced a release during the check under way.
  let found = false;
  let autoUpdater: AutoUpdaterPort | null = null;
  const now = deps.now ?? (() => new Date());
  const notesUrl = (version: string): string =>
    releaseNotesUrl(version, deps.feedOrigin ?? buildChannel().feedOrigin);

  const set = (next: AppUpdateState): void => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    deps.log(
      "update",
      next.status === "available" ? { ...next, downloadUrl: download } : { ...next },
    );
    deps.onChange(next);
  };

  const upToDate = (): void => set({ status: "idle", checkedAt: now().toISOString() });

  const lookForNotice = async (): Promise<void> => {
    const newer = await checkForNewerRelease({
      fetch: deps.fetch,
      appVersion: deps.appVersion,
      arch: deps.arch,
      feedOrigin: deps.feedOrigin,
    });
    download = newer?.downloadUrl ?? newer?.releaseUrl ?? null;
    if (!newer) return upToDate();
    set({
      status: "available",
      version: newer.version,
      releaseUrl: newer.releaseUrl,
      mode: "notice",
    });
  };

  const lookForAuto = async (): Promise<void> => {
    found = false;
    await autoUpdater?.check();
    // electron-updater says nothing when there is nothing newer.
    if (!found && isQuiet(state.status)) upToDate();
  };

  /** One look at the feed. `asked`: the person asked for it, so a failure is theirs to see. */
  const look = async (asked: boolean): Promise<AppUpdateState> => {
    const before = state;
    // A download under way or done is never put back to "checking": the menu would lose its restart.
    if (asked && isQuiet(before.status)) set({ status: "checking" });
    try {
      if (deps.mode === "notice") await lookForNotice();
      else await lookForAuto();
    } catch (error) {
      const message = errorMessage(error);
      deps.log("update check failed", { message });
      if (asked && state.status === "checking") set({ status: "error", message, version: null });
    }
    return state;
  };

  const lookOnSchedule = (): void => {
    void look(false).finally(() => {
      if (!stopped)
        cancelNext = deps.schedule(lookOnSchedule, deps.intervalMs ?? CHECK_INTERVAL_MS);
    });
  };

  const fetchRelease = async (version: string): Promise<void> => {
    set({ status: "downloading", version, percent: 0 });
    try {
      await autoUpdater?.download();
    } catch (error) {
      failDownload(errorMessage(error));
    }
  };

  // A download that failed is over: left as it was, the row would say "Downloading… N%" until
  // the next check, six hours later.
  const failDownload = (message: string): void => {
    deps.log("update failed", { message });
    restartWhenReady = false;
    if (state.status === "downloading") set({ status: "error", message, version: state.version });
  };

  const listen = (port: AutoUpdaterPort): void =>
    port.listen({
      // electron-updater announces a release it has already downloaded again at every check;
      // that must not take a ready update back to "downloading".
      available: (version) => {
        found = true;
        if (state.status === "ready" && (state.version === version || !autoDownload)) return;
        if (autoDownload) set({ status: "downloading", version, percent: 0 });
        else set({ status: "available", version, releaseUrl: notesUrl(version), mode: "auto" });
      },
      progress: (percent) => {
        if (state.status === "downloading") set({ ...state, percent: Math.round(percent) });
      },
      downloaded: (version) => {
        set({ status: "ready", version, releaseUrl: notesUrl(version) });
        if (restartWhenReady) port.quitAndInstall();
      },
      // A failed check also rejects `check()`, which `look` handles; only a download fails here.
      failed: failDownload,
    });

  return {
    state: () => state,
    start: () => {
      if (deps.mode === "off") return;
      if (deps.mode === "auto") {
        autoUpdater = deps.createAutoUpdater(deps.feedOrigin);
        autoUpdater.setAutoDownload(autoDownload);
        listen(autoUpdater);
      }
      lookOnSchedule();
    },
    stop: () => {
      stopped = true;
      cancelNext?.();
    },
    check: () => (deps.mode === "off" ? Promise.resolve(state) : look(true)),
    downloadUrl: () => (state.status === "available" ? download : null),
    restartToUpdate: () => {
      if (state.status === "ready") autoUpdater?.quitAndInstall();
    },
    downloadAndRestart: async () => {
      if (state.status === "ready") return autoUpdater?.quitAndInstall();
      if (state.status !== "available" || state.mode !== "auto") return;
      restartWhenReady = true;
      await fetchRelease(state.version);
    },
    setAutoDownload: (enabled) => {
      autoDownload = enabled;
      autoUpdater?.setAutoDownload(enabled);
      // Switched on with a release waiting: fetch it now rather than at the next check.
      if (enabled && state.status === "available" && state.mode === "auto") {
        void fetchRelease(state.version);
      }
    },
  };
};

/** States a check may replace: nothing under way, nothing downloaded. */
const isQuiet = (status: AppUpdateState["status"]): boolean =>
  status === "idle" || status === "error" || status === "checking" || status === "available";

// electron-updater's messages can carry a whole HTTP response; the row has room for one line.
const errorMessage = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n")[0]?.trim() || "Something went wrong.";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};
