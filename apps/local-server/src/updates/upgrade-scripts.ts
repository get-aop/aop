// Generated upgrade scripts run detached after the server that spawned them dies, so they
// must log to disk, verify release assets before stopping anything, and restore the
// previous server when the install phase fails. Asset names and service identifiers
// mirror scripts/installer/install.sh and install.ps1.

export type UpgradeScriptOptions = {
  aopBinary: string;
  releasesBaseUrl: string;
  targetVersion: string;
  requiredAssetUrls: string[];
};

export type MacosAppUpgradeScriptOptions = {
  appBundlePath: string;
  dmgUrl: string;
  targetVersion: string;
};

/** Release assets install.sh / install.ps1 must be able to download for this platform. */
export const requiredReleaseAssetNames = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string[] => [
  releaseBinaryAssetName(platform, arch),
  "runtime-assets.tar.gz",
  "checksums.sha256",
];

export const buildReleaseAssetUrl = (
  releasesBaseUrl: string,
  targetVersion: string,
  assetName: string,
): string => `${releasesBaseUrl.replace(/\/+$/, "")}/v${targetVersion}/${assetName}`;

export const buildUpgradeScript = ({
  aopBinary,
  releasesBaseUrl,
  targetVersion,
  requiredAssetUrls,
}: UpgradeScriptOptions): string => {
  const preflightLines = requiredAssetUrls
    .map((assetUrl) => `preflight_asset "${assetUrl}"`)
    .join("\n");

  return `#!/bin/sh
set -eu
export AOP_SKIP_BROWSER_OPEN=1
AOP_UPGRADE_PORT="\${AOP_LOCAL_SERVER_PORT:-25150}"
AOP_UPGRADE_SERVICE_NAME="com.aop.local-server"
AOP_UPGRADE_SYSTEMD_SERVICE="aop-local-server.service"
AOP_UPGRADE_LOG_DIR="\${HOME}/.aop/logs"
AOP_UPGRADE_LOG="\${AOP_UPGRADE_LOG_DIR}/upgrade-${targetVersion}-$(date +%s).log"
AOP_UPGRADE_INSTALLER="\${TMPDIR:-/tmp}/aop-upgrade-install-$$.sh"

mkdir -p "$AOP_UPGRADE_LOG_DIR"
exec >>"$AOP_UPGRADE_LOG" 2>&1

log_step() {
  printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" || true
}

preflight_asset() {
  if ! curl -fsSIL -o /dev/null "$1"; then
    log_step "Preflight failed: $1 is not downloadable yet. The current server was left running."
    exit 1
  fi
}

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

restart_server() {
  log_step "Restoring the previous AOP server"
  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v launchctl >/dev/null 2>&1 && [ -f "\${HOME}/Library/LaunchAgents/\${AOP_UPGRADE_SERVICE_NAME}.plist" ]; then
      if launchctl load "\${HOME}/Library/LaunchAgents/\${AOP_UPGRADE_SERVICE_NAME}.plist"; then
        log_step "Restarted the AOP server with launchd"
        return 0
      fi
    fi
  elif command -v systemctl >/dev/null 2>&1; then
    if systemctl --user start "$AOP_UPGRADE_SYSTEMD_SERVICE"; then
      log_step "Restarted the AOP server with systemd"
      return 0
    fi
  fi
  if [ -x "${aopBinary}" ] && "${aopBinary}" run --background --port "$AOP_UPGRADE_PORT"; then
    log_step "Restarted the AOP server with aop run --background"
    return 0
  fi
  log_step "Could not restart the AOP server automatically. Run \\"${aopBinary}\\" run --background manually."
  return 1
}

log_step "Starting AOP upgrade to ${targetVersion}"
sleep 2
log_step "Preflight: verifying release assets"
${preflightLines}
if ! curl -fsSL "${releasesBaseUrl}/install.sh" -o "$AOP_UPGRADE_INSTALLER"; then
  log_step "Could not download the AOP installer. The current server was left running."
  exit 1
fi
log_step "Preflight passed. Stopping the AOP server."
unload_launchd_service
"${aopBinary}" stop >/dev/null 2>&1 || true
if ! wait_for_aop_port; then
  kill_aop_port
fi
log_step "Running the AOP ${targetVersion} installer"
if ! sh "$AOP_UPGRADE_INSTALLER" --version "${targetVersion}"; then
  log_step "Install failed for AOP ${targetVersion}."
  restart_server || true
  exit 1
fi
rm -f "$AOP_UPGRADE_INSTALLER"
log_step "Upgrade to AOP ${targetVersion} finished"
`;
};

// Windows has no lsof/launchctl and install.ps1 registers no service: free the port via
// Get-NetTCPConnection, run the PowerShell installer, and on failure relaunch the binary
// the way install.sh's no-systemd fallback does (aop run --background).
export const buildWindowsUpgradeScript = ({
  aopBinary,
  releasesBaseUrl,
  targetVersion,
  requiredAssetUrls,
}: UpgradeScriptOptions): string => {
  const preflightLines = requiredAssetUrls
    .map((assetUrl) => `Test-AopReleaseAsset "${assetUrl}"`)
    .join("\n");

  return `$ErrorActionPreference = "Stop"
$env:AOP_SKIP_BROWSER_OPEN = "1"
$port = if ($env:AOP_LOCAL_SERVER_PORT) { $env:AOP_LOCAL_SERVER_PORT } else { "25150" }
$logDir = Join-Path $env:USERPROFILE ".aop\\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -Path (Join-Path $logDir "upgrade-${targetVersion}.log") -Append | Out-Null

function Write-Step([string]$Message) {
  Write-Host "$(Get-Date -Format o) $Message"
}

function Test-AopReleaseAsset([string]$Url) {
  try {
    Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 8 | Out-Null
  } catch {
    Write-Step "Preflight failed: $Url is not downloadable yet. The current server was left running."
    Stop-Transcript | Out-Null
    exit 1
  }
}

function Restart-AopServer {
  Write-Step "Restoring the previous AOP server"
  try {
    & "${aopBinary}" run --background --port $port
    if ($LASTEXITCODE -ne 0) { throw "aop run --background exited with code $LASTEXITCODE" }
    Write-Step "Restarted the AOP server with aop run --background"
  } catch {
    Write-Step "Could not restart the AOP server automatically. Run 'aop run' manually. $_"
  }
}

Write-Step "Starting AOP upgrade to ${targetVersion}"
Start-Sleep -Seconds 2
Write-Step "Preflight: verifying release assets"
${preflightLines}
$installer = Join-Path $env:TEMP "aop-install.ps1"
try {
  Invoke-WebRequest -Uri "${releasesBaseUrl}/install.ps1" -OutFile $installer -UseBasicParsing
} catch {
  Write-Step "Could not download the AOP installer. The current server was left running. $_"
  Stop-Transcript | Out-Null
  exit 1
}
Write-Step "Preflight passed. Stopping the AOP server."
& "${aopBinary}" stop *> $null
for ($i = 0; $i -lt 10; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 1
}
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $listeners | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Write-Step "Running the AOP ${targetVersion} installer"
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Version "${targetVersion}"
  if ($LASTEXITCODE -ne 0) { throw "Installer exited with code $LASTEXITCODE" }
} catch {
  Write-Step "Install failed for AOP ${targetVersion}. $_"
  Restart-AopServer
  Stop-Transcript | Out-Null
  exit 1
}
Write-Step "Upgrade to AOP ${targetVersion} finished"
Stop-Transcript | Out-Null
`;
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

// install.ps1 ships x64 only; install.sh maps uname to linux/darwin + x64/arm64.
const releaseBinaryAssetName = (platform: NodeJS.Platform, arch: NodeJS.Architecture): string => {
  if (platform === "win32") {
    return "aop-windows-x64.exe";
  }
  const os = platform === "darwin" ? "darwin" : "linux";
  const assetArch = arch === "x64" ? "x64" : "arm64";
  return `aop-${os}-${assetArch}`;
};

const shQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
