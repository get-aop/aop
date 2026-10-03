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
 * The "This app" row's note when the host runs a newer release, or null. Only a notice: the API
 * version handshake, not this, decides whether they can talk.
 */
export const appBehindHostNote = (
  hostName: string,
  hostVersion: string,
  appVersion: string,
): string | null =>
  compareHostToApp(hostVersion, appVersion) === "newer"
    ? `${hostName} runs ${displayVersion(hostVersion)}; this app is older`
    : null;

/** The host's own note when it runs an older release than this app, or null. */
export const hostBehindAppNote = (hostVersion: string, appVersion: string): string | null =>
  compareHostToApp(hostVersion, appVersion) === "older" ? "Older than this app" : null;
