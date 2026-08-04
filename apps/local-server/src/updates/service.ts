import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AopUpdateInstallResult,
  type AopUpdateStatus,
  isReleaseVersionNewer,
  normalizeReleaseVersion,
} from "@aop/common";
import { getLogger } from "@aop/infra";
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

type UpgradeScriptOptions = {
  aopBinary: string;
  releasesBaseUrl: string;
  targetVersion: string;
};

type MacosAppUpgradeScriptOptions = {
  appBundlePath: string;
  dmgUrl: string;
  targetVersion: string;
};

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

export const buildUpgradeScript = ({
  aopBinary,
  releasesBaseUrl,
  targetVersion,
}: UpgradeScriptOptions): string => `#!/bin/sh
set -eu
export AOP_SKIP_BROWSER_OPEN=1
AOP_UPGRADE_PORT="\${AOP_LOCAL_SERVER_PORT:-25150}"
AOP_UPGRADE_SERVICE_NAME="com.aop.local-server"

unload_launchd_service() {
  if [ "$(uname -s)" != "Darwin" ] || ! command -v launchctl >/dev/null 2>&1; then
    return 0
  fi
  launchctl unload "\${HOME}/Library/LaunchAgents/\${AOP_UPGRADE_SERVICE_NAME}.plist" >/dev/null 2>&1 || true
}

wait_for_aop_port() {
  i=0
  while [ "$i" -lt 10 ]; do
    if ! command -v lsof >/dev/null 2>&1; then
      return 0
    fi
    if ! lsof -tiTCP:"$AOP_UPGRADE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

kill_aop_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  AOP_UPGRADE_PIDS="$(lsof -tiTCP:"$AOP_UPGRADE_PORT" -sTCP:LISTEN || true)"
  if [ -z "$AOP_UPGRADE_PIDS" ]; then
    return 0
  fi
  kill $AOP_UPGRADE_PIDS >/dev/null 2>&1 || true
  sleep 1
  AOP_UPGRADE_PIDS="$(lsof -tiTCP:"$AOP_UPGRADE_PORT" -sTCP:LISTEN || true)"
  if [ -n "$AOP_UPGRADE_PIDS" ]; then
    kill -9 $AOP_UPGRADE_PIDS >/dev/null 2>&1 || true
  fi
}

sleep 2
unload_launchd_service
"${aopBinary}" stop >/dev/null 2>&1 || true
if ! wait_for_aop_port; then
  kill_aop_port
fi
curl -fsSL "${releasesBaseUrl}/install.sh" | sh -s -- --version "${targetVersion}"
`;

// Windows has no lsof/launchctl: free the port via Get-NetTCPConnection and run the
// PowerShell installer, which swaps the binary in %LOCALAPPDATA%\aop.
export const buildWindowsUpgradeScript = ({
  aopBinary,
  releasesBaseUrl,
  targetVersion,
}: UpgradeScriptOptions): string => `$ErrorActionPreference = "Stop"
$env:AOP_SKIP_BROWSER_OPEN = "1"
$port = if ($env:AOP_LOCAL_SERVER_PORT) { $env:AOP_LOCAL_SERVER_PORT } else { "25150" }

Start-Sleep -Seconds 2
& "${aopBinary}" stop *> $null
for ($i = 0; $i -lt 10; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 1
}
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $listeners | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
$installer = Join-Path $env:TEMP "aop-install.ps1"
Invoke-WebRequest -Uri "${releasesBaseUrl}/install.ps1" -OutFile $installer
& powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Version "${targetVersion}"
`;

const shQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

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
  return `${releasesBaseUrl.replace(/\/+$/, "")}/v${targetVersion}/aop-macos-${assetArch}.dmg`;
};

export const verifyMacosDmgDownload = async (
  dmgUrl: string,
  targetVersion: string,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(dmgUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "download check failed";
    throw new Error(`Could not verify the AOP ${targetVersion} macOS update asset: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(
      `The macOS update asset is not available yet for AOP ${targetVersion} (${response.status}). Try again in a minute.`,
    );
  }
};

export const buildMacosAppUpgradeScript = ({
  appBundlePath,
  dmgUrl,
  targetVersion,
}: MacosAppUpgradeScriptOptions): string => `#!/bin/sh
set -u

AOP_APP_BUNDLE=${shQuote(appBundlePath)}
AOP_DMG_URL=${shQuote(dmgUrl)}
AOP_TARGET_VERSION=${shQuote(targetVersion)}
AOP_UPDATE_DIR="\${TMPDIR:-/tmp}/aop-update-\${AOP_TARGET_VERSION}-$$"
AOP_DMG_PATH="$AOP_UPDATE_DIR/AOP-\${AOP_TARGET_VERSION}.dmg"
AOP_MOUNT_DIR="$AOP_UPDATE_DIR/mount"
AOP_PARENT="$(dirname "$AOP_APP_BUNDLE")"
AOP_STAGE="$AOP_PARENT/.AOP.app.update.$$"
AOP_BACKUP="$AOP_PARENT/.AOP.app.backup.$$"
AOP_LOG="$HOME/.aop/logs/desktop-updater.log"

log() {
  mkdir -p "$(dirname "$AOP_LOG")" >/dev/null 2>&1 || true
  printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$AOP_LOG" 2>/dev/null || true
}

cleanup() {
  hdiutil detach "$AOP_MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rm -rf "$AOP_UPDATE_DIR" "$AOP_STAGE" >/dev/null 2>&1 || true
}

open_existing_app() {
  if [ -d "$AOP_APP_BUNDLE" ]; then
    open "$AOP_APP_BUNDLE" >/dev/null 2>&1 || true
  fi
}

restore_backup() {
  if [ -d "$AOP_BACKUP" ] && [ ! -d "$AOP_APP_BUNDLE" ]; then
    mv "$AOP_BACKUP" "$AOP_APP_BUNDLE" >/dev/null 2>&1 || true
  fi
}

download_dmg() {
  i=1
  while [ "$i" -le 6 ]; do
    if curl -fL "$AOP_DMG_URL" -o "$AOP_DMG_PATH"; then
      return 0
    fi

    log "AOP DMG download attempt $i failed"
    i=$((i + 1))
    sleep 5
  done

  return 1
}

fail() {
  log "$1"
  restore_backup
  open_existing_app
  exit 1
}

trap cleanup EXIT

mkdir -p "$AOP_UPDATE_DIR" "$AOP_MOUNT_DIR" || fail "Could not create update workspace"
log "Starting AOP desktop update to $AOP_TARGET_VERSION"

download_dmg || fail "Could not download AOP DMG"
hdiutil attach "$AOP_DMG_PATH" -mountpoint "$AOP_MOUNT_DIR" -nobrowse -readonly -quiet || \
  fail "Could not mount AOP DMG"

if [ ! -d "$AOP_MOUNT_DIR/AOP.app" ]; then
  fail "Mounted DMG did not contain AOP.app"
fi

rm -rf "$AOP_STAGE" "$AOP_BACKUP" >/dev/null 2>&1 || true
ditto "$AOP_MOUNT_DIR/AOP.app" "$AOP_STAGE" || fail "Could not stage updated AOP.app"

osascript -e 'tell application id "com.getaop.aop" to quit' >/dev/null 2>&1 || \
  osascript -e 'tell application "AOP" to quit' >/dev/null 2>&1 || true
sleep 2

if [ -d "$AOP_APP_BUNDLE" ]; then
  mv "$AOP_APP_BUNDLE" "$AOP_BACKUP" || fail "Could not move current AOP.app aside"
fi

if ! mv "$AOP_STAGE" "$AOP_APP_BUNDLE"; then
  restore_backup
  fail "Could not install updated AOP.app"
fi

rm -rf "$AOP_BACKUP" >/dev/null 2>&1 || true
xattr -dr com.apple.quarantine "$AOP_APP_BUNDLE" >/dev/null 2>&1 || true
log "Installed AOP $AOP_TARGET_VERSION at $AOP_APP_BUNDLE"
open "$AOP_APP_BUNDLE" >/dev/null 2>&1 || log "Installed AOP but could not relaunch $AOP_APP_BUNDLE"
`;

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

  const scriptOptions = { aopBinary, releasesBaseUrl, targetVersion: normalizedTarget };
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
