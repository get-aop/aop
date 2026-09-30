import { RELEASE_REPO } from "@aop/common";
import { autoUpdater } from "electron-updater";
import type { AutoUpdaterPort } from "./app-updater";

/**
 * electron-updater behind the app's port. The only file that imports it, and only a packaged app
 * builds it: the package reads `app-update.yml`, which electron-builder writes into the app's
 * resources from the `publish` entry of the builder config. That entry names the same GitHub
 * Releases the host updates from, so `latest.yml` and the blockmap on a release are the feed.
 */
export const createElectronUpdaterPort = (): AutoUpdaterPort => {
  const [owner, repo] = RELEASE_REPO.split("/");
  autoUpdater.setFeedURL({ provider: "github", owner, repo });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The feed is a stable release channel; a pre-release never reaches an installed app.
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  return {
    listen: (handlers) => {
      autoUpdater.on("update-available", (info) => handlers.available(info.version));
      autoUpdater.on("download-progress", (progress) => handlers.progress(progress.percent));
      autoUpdater.on("update-downloaded", (info) => handlers.downloaded(info.version));
      autoUpdater.on("error", (error) => handlers.failed(error.message));
    },
    check: async () => {
      await autoUpdater.checkForUpdates();
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
};
