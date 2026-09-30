import { compareReleaseVersions, isReleaseVersion } from "@aop/common";

export type HostVsApp = "newer" | "older" | "same" | "unknown";

/**
 * How the host's release compares with this app's. `unknown` when either is not a release
 * (a host built from source reports `dev`), because there is nothing to say then.
 */
export const compareHostToApp = (hostVersion: string, appVersion: string): HostVsApp => {
  if (!isReleaseVersion(hostVersion) || !isReleaseVersion(appVersion)) return "unknown";
  const order = compareReleaseVersions(hostVersion, appVersion);
  if (order === 0) return "same";
  return order > 0 ? "newer" : "older";
};

/** The release without build metadata: `0.10.0+abc1234` is shown as `0.10.0`. */
export const displayVersion = (version: string): string => version.split("+")[0] ?? version;

/**
 * A line for the person when host and app are on different releases, or null. It is only a
 * notice: the API version handshake, not this, decides whether they can talk.
 */
export const hostVersionNotice = (hostVersion: string, appVersion: string): string | null => {
  const host = displayVersion(hostVersion);
  const app = displayVersion(appVersion);
  switch (compareHostToApp(hostVersion, appVersion)) {
    case "newer":
      return `The host (${host}) is newer than this app (${app}). Update the app.`;
    case "older":
      return `The host (${host}) is older than this app (${app}). Update the host with "aop update".`;
    default:
      return null;
  }
};
