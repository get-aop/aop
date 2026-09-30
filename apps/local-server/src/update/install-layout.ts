import { basename, dirname, join } from "node:path";

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
 * The installed host this process is, or null when it is not one. Only the compiled `aop`
 * binary can replace itself: a source checkout runs under `bun`, and overwriting that would
 * break the machine's runtime rather than update AOP.
 */
export const detectInstall = (
  execPath: string = process.execPath,
  buildVersion: string | undefined = process.env.AOP_BUILD_VERSION,
): InstallLayout | null =>
  buildVersion?.trim() && basename(execPath) === "aop" ? layoutOf(execPath) : null;

/** The platform this host runs on, or null for one the releases do not ship a host for. */
export const detectPlatform = (
  platform: string = process.platform,
  arch: string = process.arch,
): HostPlatform | null => {
  const os = platform === "darwin" || platform === "linux" ? platform : null;
  const cpu = arch === "x64" || arch === "arm64" ? arch : null;
  return os && cpu ? { os, arch: cpu } : null;
};

/** The release asset holding the host binary for `platform`, named as install.sh names it. */
export const hostAssetName = ({ os, arch }: HostPlatform): string => `aop-${os}-${arch}`;
