import { desktopUpdaterFeedUrl } from "@aop/common";
import { autoUpdater } from "electron-updater";
import type { AutoUpdaterPort } from "./app-updater";

/**
 * electron-updater behind the app's port. The only file that imports it, and only a packaged app
 * builds it. The feed is getaop.com/latest/: `latest.yml` there names the versioned Windows
 * installer and its blockmap, `latest-mac.yml` the versioned macOS zips (deploy-r2.sh). It is set
 * here as well as in `app-update.yml`, so an app built before the repository's GitHub Releases
 * stopped being the feed still finds it.
 */
export const createElectronUpdaterPort = (feedOrigin?: string): AutoUpdaterPort => {
  autoUpdater.setFeedURL({ provider: "generic", url: desktopUpdaterFeedUrl(feedOrigin) });
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
