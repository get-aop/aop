import type { DesktopAppInfo } from "@aop/common";
import type { DesktopIpcHost } from "../ipc";
import type { AppUpdater } from "./app-updater";

export type AppUpdateHost = Pick<
  DesktopIpcHost,
  | "getAppInfo"
  | "getUpdateState"
  | "checkForUpdates"
  | "downloadAndRestart"
  | "openUpdateDownload"
  | "restartToUpdate"
  | "setAutoDownload"
>;

export interface AppUpdateHostDeps {
  updater: AppUpdater;
  info: Omit<DesktopAppInfo, "autoDownload">;
  /** desktop-config `autoDownloadUpdates`, as saved when the app started. */
  autoDownload: boolean;
  saveAutoDownload: (enabled: boolean) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  /** Only the release feed's own links open from here (security.ts, `isSafeUpdateUrl`). */
  isSafeDownloadUrl: (url: string) => boolean;
}

/** "This app"'s update as either of the app's pages asks for it (DesktopAppUpdateBridge). */
export const createAppUpdateHost = (deps: AppUpdateHostDeps): AppUpdateHost => {
  let autoDownload = deps.autoDownload;
  return {
    getAppInfo: () => ({ ...deps.info, autoDownload }),
    getUpdateState: () => deps.updater.state(),
    checkForUpdates: () => deps.updater.check(),
    downloadAndRestart: () => deps.updater.downloadAndRestart(),
    openUpdateDownload: async () => {
      const url = deps.updater.downloadUrl();
      if (url && deps.isSafeDownloadUrl(url)) await deps.openExternal(url);
    },
    restartToUpdate: async () => deps.updater.restartToUpdate(),
    setAutoDownload: async (enabled) => {
      await deps.saveAutoDownload(enabled);
      autoDownload = enabled;
      deps.updater.setAutoDownload(enabled);
    },
  };
};
