import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AopUpdateInstallResult,
  type AopUpdateStatus,
  isReleaseVersionNewer,
  normalizeReleaseVersion,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import {
  buildMacosAppUpgradeScript,
  buildReleaseAssetUrl,
  buildUpgradeScript,
  buildWindowsUpgradeScript,
  requiredReleaseAssetNames,
} from "./upgrade-scripts.ts";
import { isCompiledBinaryInstall, resolveInstalledVersion } from "./version.ts";

const logger = getLogger("updates");

const DEFAULT_RELEASES_BASE_URL = "https://getaop.com";

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * True when the sidecar belongs to AOP Desktop's managed WSL runtime. The explicit marker is
 * authoritative; AOP_EXEC_HOST remains supported for older Desktop releases.
 */
export const isDesktopManagedWsl = (
  env: Record<string, string | undefined> = process.env,
): boolean =>
  env.AOP_DESKTOP_MANAGED_RUNTIME === "1" || (env.AOP_EXEC_HOST ?? "").startsWith("wsl:");

// The releases base URL feeds a curl|sh upgrade script; require https (or
// loopback for tests) so a plain-http override cannot be MITM'd into RCE.
const resolveReleasesBaseUrl = (): string => {
  const base = process.env.AOP_RELEASES_URL ?? DEFAULT_RELEASES_BASE_URL;
  const url = new URL(base);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !loopback) {
    throw new Error(`Releases base URL must use https: ${base}`);
  }
  return base;
};

export const isMacosAppBundleInstall = (
  execPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean => platform === "darwin" && execPath.includes(".app/Contents/Resources/");

export const resolveMacosAppBundlePath = (execPath: string): string | null => {
  const marker = ".app/Contents/Resources/";
  const markerIndex = execPath.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return execPath.slice(0, markerIndex + ".app".length);
};

export const buildMacosDmgDownloadUrl = (
  targetVersion: string,
  arch: NodeJS.Architecture = process.arch,
  releasesBaseUrl = resolveReleasesBaseUrl(),
): string => {
  const assetArch = arch === "x64" ? "x64" : "arm64";
  return buildReleaseAssetUrl(releasesBaseUrl, targetVersion, `aop-macos-${assetArch}.dmg`);
};

/**
 * HEAD-check one release asset before any destructive upgrade step, so a version pointer
 * that flipped ahead of the uploaded assets fails fast while the server is still running.
 */
export const verifyReleaseAsset = async (
  assetUrl: string,
  targetVersion: string,
  assetLabel: string,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(assetUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "download check failed";
    throw new Error(`Could not verify the AOP ${targetVersion} ${assetLabel}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(
      `The ${assetLabel} is not available yet for AOP ${targetVersion} (${response.status}). Try again in a minute.`,
    );
  }
};

export const verifyMacosDmgDownload = (dmgUrl: string, targetVersion: string): Promise<void> =>
  verifyReleaseAsset(dmgUrl, targetVersion, "macOS update asset");

export const fetchLatestReleaseVersion = async (
  releasesBaseUrl = resolveReleasesBaseUrl(),
): Promise<string> => {
  const response = await fetch(`${releasesBaseUrl}/latest/version`, {
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Version check failed with status ${response.status}`);
  }

  const latestVersion = normalizeReleaseVersion(await response.text());
  if (!latestVersion) {
    throw new Error("Latest version response was empty");
  }

  return latestVersion;
};

export const getUpdateStatus = async (): Promise<AopUpdateStatus> => {
  const currentVersion = await resolveInstalledVersion();
  const canAutoUpdate = (await isCompiledBinaryInstall()) && !isDesktopManagedWsl();

  try {
    const latestVersion = await fetchLatestReleaseVersion();
    const updateAvailable = canAutoUpdate && isReleaseVersionNewer(latestVersion, currentVersion);

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      canAutoUpdate,
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      canAutoUpdate,
      checkError: error instanceof Error ? error.message : "Failed to check for updates",
    };
  }
};

const startMacosAppBundleUpgrade = async (
  aopBinary: string,
  targetVersion: string,
  releasesBaseUrl: string,
): Promise<AopUpdateInstallResult> => {
  const downloadUrl = buildMacosDmgDownloadUrl(targetVersion, process.arch, releasesBaseUrl);
  await verifyMacosDmgDownload(downloadUrl, targetVersion);

  const appBundlePath = resolveMacosAppBundlePath(aopBinary);
  if (!appBundlePath) {
    throw new Error("Could not resolve AOP.app bundle path for desktop update");
  }

  const upgradeScriptPath = join(homedir(), ".aop", "macos-app-upgrade.sh");
  const script = buildMacosAppUpgradeScript({
    appBundlePath,
    dmgUrl: downloadUrl,
    targetVersion,
  });

  await Bun.write(upgradeScriptPath, script);
  await Bun.$`chmod +x ${upgradeScriptPath}`.quiet();

  Bun.spawn(["sh", upgradeScriptPath], {
    cwd: homedir(),
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
    detached: true,
  }).unref();

  return {
    status: "started",
    targetVersion,
    message: `Installing AOP ${targetVersion}. The app will restart shortly.`,
  };
};

// Fail fast while the server is still running: a version pointer can flip before the
// release assets finish uploading, and the detached script must never stop the server
// for an install that cannot download.
const verifyRequiredReleaseAssets = async (
  releasesBaseUrl: string,
  targetVersion: string,
  platform: NodeJS.Platform,
): Promise<string[]> => {
  const requiredAssetUrls: string[] = [];
  for (const assetName of requiredReleaseAssetNames(platform, process.arch)) {
    const assetUrl = buildReleaseAssetUrl(releasesBaseUrl, targetVersion, assetName);
    await verifyReleaseAsset(assetUrl, targetVersion, `${assetName} release asset`);
    requiredAssetUrls.push(assetUrl);
  }

  logger.info("Verified {assetCount} release assets for AOP {targetVersion}", {
    assetCount: requiredAssetUrls.length,
    targetVersion,
  });

  return requiredAssetUrls;
};

export const startBinaryUpgrade = async (
  targetVersion: string,
  platform: NodeJS.Platform = process.platform,
): Promise<AopUpdateInstallResult> => {
  const normalizedTarget = normalizeReleaseVersion(targetVersion);
  if (!normalizedTarget) {
    throw new Error("Target version is required");
  }
  if (!RELEASE_VERSION_PATTERN.test(normalizedTarget)) {
    throw new Error(`Target version is not a valid release version: ${targetVersion}`);
  }

  if (isDesktopManagedWsl()) {
    throw new Error(
      "AOP Desktop manages this runtime inside WSL, so it cannot update itself. Update AOP Desktop to install the matching runtime.",
    );
  }

  const canAutoUpdate = await isCompiledBinaryInstall();
  if (!canAutoUpdate) {
    throw new Error("Automatic updates are only available for compiled binary installs");
  }

  const releasesBaseUrl = resolveReleasesBaseUrl();
  const aopBinary = process.execPath;
  const isWindows = platform === "win32";
  if (isMacosAppBundleInstall(aopBinary, platform)) {
    return startMacosAppBundleUpgrade(aopBinary, normalizedTarget, releasesBaseUrl);
  }

  const requiredAssetUrls = await verifyRequiredReleaseAssets(
    releasesBaseUrl,
    normalizedTarget,
    platform,
  );

  const scriptOptions = {
    aopBinary,
    releasesBaseUrl,
    targetVersion: normalizedTarget,
    requiredAssetUrls,
  };
  const upgradeScriptPath = join(homedir(), ".aop", isWindows ? "upgrade.ps1" : "upgrade.sh");
  const script = isWindows
    ? buildWindowsUpgradeScript(scriptOptions)
    : buildUpgradeScript(scriptOptions);

  await Bun.write(upgradeScriptPath, script);
  if (!isWindows) {
    await Bun.$`chmod +x ${upgradeScriptPath}`.quiet();
  }

  const spawnCommand = isWindows
    ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", upgradeScriptPath]
    : ["sh", upgradeScriptPath];
  Bun.spawn(spawnCommand, {
    cwd: homedir(),
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
    detached: true,
  }).unref();

  logger.info("Started background upgrade to {targetVersion}", {
    targetVersion: normalizedTarget,
  });

  return {
    status: "started",
    targetVersion: normalizedTarget,
    message: `Upgrading to AOP ${normalizedTarget}. The server will restart shortly.`,
  };
};
