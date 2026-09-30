import { compareHostToApp, displayVersion } from "./host-version";
import type { AppUpdateState } from "./types";

/** The short line for the window title and the menu, or null when there is nothing to say. */
export const updateLabel = (update: AppUpdateState): string | null => {
  switch (update.status) {
    case "idle":
      return null;
    case "available":
      return `Update available (${update.version})`;
    case "downloading":
      return `Downloading update (${update.version})`;
    case "ready":
      return `Restart to update (${update.version})`;
  }
};

/** A few words for the window title when host and app are on different releases, or null. */
export const hostDriftTag = (hostVersion: string, appVersion: string): string | null => {
  switch (compareHostToApp(hostVersion, appVersion)) {
    case "newer":
      return `host ${displayVersion(hostVersion)} is newer`;
    case "older":
      return `host ${displayVersion(hostVersion)} is older`;
    default:
      return null;
  }
};
