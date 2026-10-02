/**
 * Which AOP a build is: the stable release or AOP Nightly, built from `main` after every merge
 * (docs/NIGHTLY.md). The two run side by side on one machine, so everything that names an
 * install (its data folder, ports, service names, binary, app id and update feed) comes from
 * this table, never from a literal elsewhere.
 */
export type ReleaseChannel = "stable" | "nightly";

export interface ChannelConfig {
  id: ReleaseChannel;
  /** The data folder under the home directory, unless `AOP_HOME` names another. */
  homeDirName: string;
  hostPort: number;
  dashboardPort: number;
  /** The CLI and host binary install.sh puts on PATH. */
  binaryName: string;
  launchdLabel: string;
  /** The systemd user unit, without `.service`. */
  systemdUnit: string;
  /** Electron's app id and the macOS bundle id. */
  appId: string;
  /** The desktop app's name; Electron derives its data folder and keychain item from it. */
  productName: string;
  /** Where install.sh, the feed and the build's files are published. */
  feedOrigin: string;
}

const PUBLIC_ORIGIN = "https://getaop.com";

export const CHANNELS: Record<ReleaseChannel, ChannelConfig> = {
  stable: {
    id: "stable",
    homeDirName: ".aop",
    hostPort: 25150,
    dashboardPort: 25160,
    binaryName: "aop",
    launchdLabel: "com.aop.local-server",
    systemdUnit: "aop-local-server",
    appId: "com.getaop.aop",
    productName: "AOP",
    feedOrigin: PUBLIC_ORIGIN,
  },
  nightly: {
    id: "nightly",
    homeDirName: ".aop-nightly",
    hostPort: 25650,
    dashboardPort: 25660,
    binaryName: "aop-nightly",
    launchdLabel: "com.aop.local-server.nightly",
    systemdUnit: "aop-nightly-local-server",
    appId: "com.getaop.aop.nightly",
    productName: "AOP Nightly",
    feedOrigin: `${PUBLIC_ORIGIN}/nightly`,
  },
};

// Replaced by the bundler (`define`) when AOP_BUILD_CHANNEL is set at build time; a source run
// and every stable build leave it undefined.
declare const AOP_BUILD_CHANNEL: string | undefined;

/** Reads a channel name, as the build scripts and the workflow pass it. Anything else is stable. */
export const parseReleaseChannel = (value: string | undefined | null): ReleaseChannel =>
  value?.trim() === "nightly" ? "nightly" : "stable";

/** The channel this build was made for. */
export const buildChannel = (): ChannelConfig =>
  CHANNELS[parseReleaseChannel(typeof AOP_BUILD_CHANNEL === "string" ? AOP_BUILD_CHANNEL : null)];

/** The bundler `define` entry that bakes `channel` into a build. */
export const channelDefine = (channel: ReleaseChannel): Record<string, string> => ({
  AOP_BUILD_CHANNEL: JSON.stringify(channel),
});
