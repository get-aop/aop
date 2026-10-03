import { buildChannel, desktopUpdaterFeedUrl } from "@aop/common";
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
  const channel = buildChannel();
  autoUpdater.setFeedURL({
    provider: "generic",
    url: desktopUpdaterFeedUrl(feedOrigin ?? channel.feedOrigin),
  });
  // A downloaded build installs when the app quits, as well as on "Restart to update".
  autoUpdater.autoInstallOnAppQuit = true;
  // Stable's feed is releases only, and a pre-release never reaches a stable app. AOP Nightly's
  // feed (getaop.com/nightly/latest/) is nothing but pre-releases, `0.10.7-nightly.<date>.<run>`.
  autoUpdater.allowPrerelease = channel.id === "nightly";
  autoUpdater.allowDowngrade = false;

  return {
    listen: (handlers) => {
      autoUpdater.on("update-available", (info) => handlers.available(info.version));
      autoUpdater.on("download-progress", (progress) => handlers.progress(progress.percent));
      autoUpdater.on("update-downloaded", (info) => handlers.downloaded(info.version));
      autoUpdater.on("error", (error) => handlers.failed(error.message));
    },
    setAutoDownload: (enabled) => {
      autoUpdater.autoDownload = enabled;
    },
    check: async () => {
      await autoUpdater.checkForUpdates();
    },
    download: async () => {
      await autoUpdater.downloadUpdate();
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
};
