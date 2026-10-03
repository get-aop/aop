import { basename, dirname, join } from "node:path";
import { buildChannel, type ChannelConfig } from "@aop/common";

/** Where install.sh put the host: the binary and the dashboard folder beside it. */
export interface InstallLayout {
  installDir: string;
  binaryPath: string;
  dashboardDir: string;
}

export interface HostPlatform {
  os: "darwin" | "linux";
  arch: "x64" | "arm64";
}

export const layoutOf = (binaryPath: string): InstallLayout => {
  const installDir = dirname(binaryPath);
  return { installDir, binaryPath, dashboardDir: join(installDir, "dashboard") };
};

/**
 * Why this process cannot replace itself, or null when it can. Only the compiled binary
 * install.sh puts in place (`aop`, or `aop-nightly` for AOP Nightly) can:
 * - `source`: a source checkout runs under `bun`, and overwriting that would break the machine's
 *   runtime rather than update AOP;
 * - `app`: the host the macOS app ships in its bundle comes and goes with the app, and rewriting a
 *   file inside a signed bundle would break the app's signature;
 * - `other-binary`: anything else, such as a copy run from a download folder.
 */
export type SelfUpdateBlock = "source" | "app" | "other-binary";

export const selfUpdateBlock = (
  execPath: string,
  buildVersion: string | undefined,
  channel: ChannelConfig = buildChannel(),
): SelfUpdateBlock | null => {
  if (!buildVersion?.trim()) return "source";
  if (execPath.includes(".app/Contents/")) return "app";
  return basename(execPath) === channel.binaryName ? null : "other-binary";
};

/** The installed host this process is, or null when it cannot replace itself (selfUpdateBlock). */
export const detectInstall = (
  execPath: string = process.execPath,
  buildVersion: string | undefined = process.env.AOP_BUILD_VERSION,
  channel: ChannelConfig = buildChannel(),
): InstallLayout | null =>
  selfUpdateBlock(execPath, buildVersion, channel) === null ? layoutOf(execPath) : null;

/** What the person reads when this host cannot update itself, and what to do instead. */
export const selfUpdateRefusal = (
  block: SelfUpdateBlock,
  execPath: string,
  channel: ChannelConfig = buildChannel(),
): string => {
  const bin = channel.binaryName;
  switch (block) {
    case "source":
      return "This host runs from source and cannot update itself: pull and rebuild instead.";
    case "app":
      return `This host comes with the ${channel.productName} app and updates with it: update the app instead.`;
    case "other-binary":
      return `\`${bin} update\` replaces the installed "${bin}" binary, and this one is ${execPath}. Install the release with install.sh, or run \`${bin} update --check\` to only look.`;
  }
};

/**
 * The platform this host runs on, or null for one the releases do not ship a host for. An x64
 * host that macOS runs through Rosetta (`translated`) is on Apple silicon, so the update brings
 * it the arm64 build, which runs natively.
 */
export const detectPlatform = (
  platform: string = process.platform,
  arch: string = process.arch,
  translated = false,
): HostPlatform | null => {
  const os = platform === "darwin" || platform === "linux" ? platform : null;
  const cpu = arch === "x64" || arch === "arm64" ? arch : null;
  if (!os || !cpu) return null;
  return { os, arch: os === "darwin" && translated ? "arm64" : cpu };
};

/** The release asset holding the host binary for `platform`, named as install.sh names it. */
export const hostAssetName = ({ os, arch }: HostPlatform): string => `aop-${os}-${arch}`;
