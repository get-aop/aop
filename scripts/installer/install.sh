#!/bin/sh
# AOP install script — download, install, and start AOP.
# Usage: curl -fsSL https://getaop.com/install.sh | sh
#        curl -fsSL https://getaop.com/install.sh | sh -s -- --prefix /custom/path --version 0.2.0
set -eu

RELEASES_BASE_URL="${AOP_RELEASES_URL:-https://getaop.com}"
AOP_GITHUB_REPO="${AOP_GITHUB_REPO:-get-aop/aop-mono}"
RUNTIME_ASSETS_NAME="runtime-assets.tar.gz"
LOCAL_SERVER_PORT="${AOP_LOCAL_SERVER_PORT:-25150}"
DASHBOARD_PORT="${AOP_DASHBOARD_PORT:-25160}"
LOCAL_SERVER_URL="${AOP_LOCAL_SERVER_URL:-http://aop.localhost:${LOCAL_SERVER_PORT}}"
LOCAL_SERVER_HEALTH_URL="http://127.0.0.1:${LOCAL_SERVER_PORT}"
DASHBOARD_URL="${AOP_DASHBOARD_URL:-http://localhost:${DASHBOARD_PORT}}"
LICENSE_SERVER_URL="${AOP_LICENSE_SERVER_URL:-}"
CHECKOUT_PRO_URL="${AOP_CHECKOUT_PRO_URL:-}"
CHECKOUT_TEAM_URL="${AOP_CHECKOUT_TEAM_URL:-}"
LOG_DIR="${AOP_LOG_DIR:-${HOME}/.aop/logs}"
LOG_PATH="${LOG_DIR}/local-server.log"
SERVICE_NAME="com.aop.local-server"
SYSTEMD_SERVICE_NAME="aop-local-server"

main() {
  parse_args "$@"
  detect_platform
  run_preflight_checks
  install_linux_deps
  resolve_version
  resolve_install_dir
  check_existing_installation
  stop_existing_service
  download_release_artifacts
  verify_checksum "$BINARY_NAME"
  verify_checksum "$RUNTIME_ASSETS_NAME"
  install_binary
  install_runtime_assets
  start_local_server
  wait_for_local_server
  check_post_install_warnings
  print_success
}

# --- Argument Parsing ---

PREFIX=""
VERSION=""

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --prefix)
        PREFIX="$2"
        shift 2
        ;;
      --version)
        VERSION="$2"
        shift 2
        ;;
      *)
        echo "Unknown argument: $1" >&2
        echo "Usage: install.sh [--prefix <dir>] [--version <version>]" >&2
        exit 1
        ;;
    esac
  done
}

# --- Platform Detection ---

OS=""
ARCH=""
BINARY_NAME=""

detect_platform() {
  local uname_os uname_arch

  uname_os="$(uname -s)"
  uname_arch="$(uname -m)"

  case "$uname_os" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)
      echo "Error: Unsupported operating system: $uname_os" >&2
      echo "Supported platforms: Linux (x64, arm64), macOS (x64, arm64)" >&2
      exit 1
      ;;
  esac

  case "$uname_arch" in
    x86_64|amd64)    ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $uname_arch" >&2
      echo "Supported architectures: x86_64, aarch64/arm64" >&2
      exit 1
      ;;
  esac

  BINARY_NAME="aop-${OS}-${ARCH}"
  echo "Detected platform: ${OS}-${ARCH}"
}

# --- Preflight Checks ---

run_preflight_checks() {
  if [ "${AOP_SKIP_PREFLIGHT:-}" = "1" ] || [ "${AOP_SKIP_PREFLIGHT:-}" = "true" ]; then
    echo "Skipping AOP preflight checks."
    return
  fi

  local issues=""

  if ! command -v git >/dev/null 2>&1; then
    issues="${issues}
  - Git 2.40+ is required for AOP worktree management.
    Fix: install Git from https://git-scm.com/downloads"
  fi

  if ! command -v gh >/dev/null 2>&1; then
    issues="${issues}
  - GitHub CLI is required for pull requests and check status.
    Fix: install GitHub CLI from https://cli.github.com/ and run: gh auth login -h github.com"
  elif ! gh auth status -h github.com >/dev/null 2>&1; then
    issues="${issues}
  - GitHub CLI is not authenticated for github.com.
    Fix: run: gh auth login -h github.com"
  fi

  if ! has_supported_runtime_cli; then
    issues="${issues}
  - No supported agent runtime found.
    Fix: install and sign in to at least one of: claude, opencode, codex, or pi"
  fi

  if [ -n "$issues" ]; then
    echo "AOP preflight checks failed." >&2
    echo "" >&2
    echo "AOP needs GitHub access and at least one local coding runtime before install." >&2
    printf '%s\n' "$issues" >&2
    echo "" >&2
    echo "After fixing the items above, rerun:" >&2
    echo "  curl -fsSL https://getaop.com/install.sh | sh" >&2
    echo "" >&2
    echo "Advanced users can bypass this check with:" >&2
    echo "  curl -fsSL https://getaop.com/install.sh | AOP_SKIP_PREFLIGHT=1 sh" >&2
    exit 1
  fi

  echo "AOP preflight checks passed."
}

has_supported_runtime_cli() {
  command -v claude >/dev/null 2>&1 ||
    command -v opencode >/dev/null 2>&1 ||
    command -v codex >/dev/null 2>&1 ||
    command -v pi >/dev/null 2>&1
}

# --- Linux Dependencies ---

install_linux_deps() {
  if [ "$OS" != "linux" ]; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Note: apt-get not found. If the compiled binary fails to start, install libnss3, libnspr4, libasound2t64" >&2
    return
  fi

  echo "Ensuring Linux dependencies (libnss3, libnspr4, libasound2t64)..."
  run_apt() {
    if [ "$(id -u)" = 0 ]; then
      apt-get update -qq
      apt-get install -y --no-install-recommends "$@" || apt --fix-broken install -y
    else
      sudo apt-get update -qq
      sudo apt-get install -y --no-install-recommends "$@" || sudo apt --fix-broken install -y
    fi
  }
  run_apt libnss3 libnspr4 libasound2t64 2>/dev/null || run_apt libnss3 libnspr4 libasound2 2>/dev/null || true
}

# --- Version Resolution ---

resolve_version() {
  if [ -n "$VERSION" ]; then
    echo "Using specified version: $VERSION"
    return
  fi

  echo "Fetching latest version..."
  VERSION="$(http_get "${RELEASES_BASE_URL}/latest/version")" || {
    echo "Error: Failed to fetch latest version from ${RELEASES_BASE_URL}/latest/version" >&2
    exit 1
  }
  VERSION="$(echo "$VERSION" | tr -d '[:space:]')"
  echo "Latest version: $VERSION"
}

# --- Install Directory ---

INSTALL_DIR=""

resolve_install_dir() {
  if [ -n "$PREFIX" ]; then
    INSTALL_DIR="${PREFIX}/bin"
  elif [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
  fi

  mkdir -p "$INSTALL_DIR"
}

# --- Existing Installation Check ---

EXISTING_VERSION=""

check_existing_installation() {
  local existing_bin="${INSTALL_DIR}/aop"

  if [ -x "$existing_bin" ]; then
    EXISTING_VERSION="$("$existing_bin" --version 2>/dev/null || echo "")"
    if [ "$EXISTING_VERSION" = "$VERSION" ]; then
      echo "AOP $VERSION is already installed; refreshing assets and service"
    fi
  fi
}

# --- HTTP Helpers ---

TMPDIR="${TMPDIR:-/tmp}"
TMP_DIR=""

http_get() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

http_download() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$output" "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

http_download_optional() {
  http_download "$@" 2>/dev/null
}

github_release_asset_url() {
  printf 'https://github.com/%s/releases/download/v%s/%s' "$AOP_GITHUB_REPO" "$VERSION" "$1"
}

# --- Download ---

download_release_artifacts() {
  TMP_DIR="$(mktemp -d "${TMPDIR}/aop-install.XXXXXX")"
  trap 'rm -rf "$TMP_DIR"' EXIT

  local checksums_url="${RELEASES_BASE_URL}/v${VERSION}/checksums.sha256"

  if ! http_download_optional "$checksums_url" "${TMP_DIR}/checksums.sha256"; then
    checksums_url="$(github_release_asset_url "checksums.sha256")"
    http_download "$checksums_url" "${TMP_DIR}/checksums.sha256" || {
      echo "Error: Failed to download checksums.sha256" >&2
      exit 1
    }
  fi

  download_release_asset "$BINARY_NAME"
  download_release_asset "$RUNTIME_ASSETS_NAME"
}

download_release_asset() {
  local name="$1"
  local asset_url="${RELEASES_BASE_URL}/v${VERSION}/${name}"

  echo "Downloading ${name} v${VERSION}..."
  if ! http_download_optional "$asset_url" "${TMP_DIR}/${name}"; then
    echo "Primary CDN miss — trying GitHub Releases..."
    asset_url="$(github_release_asset_url "$name")"
    http_download "$asset_url" "${TMP_DIR}/${name}" || {
      echo "Error: Failed to download ${name} from getaop.com or GitHub Releases" >&2
      exit 1
    }
  fi
}

# --- Checksum Verification ---

verify_checksum() {
  local name="$1"
  local expected actual

  expected="$(awk -v name="$name" '$2 == name { print $1; exit }' "${TMP_DIR}/checksums.sha256")"

  if [ -z "$expected" ]; then
    echo "Error: No checksum found for ${name} in checksums.sha256" >&2
    rm -f "${TMP_DIR}/${name}"
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${TMP_DIR}/${name}" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${TMP_DIR}/${name}" | cut -d' ' -f1)"
  else
    echo "Error: sha256sum or shasum is required to verify downloads. Install coreutils and retry." >&2
    rm -f "${TMP_DIR}/${name}"
    exit 1
  fi

  if [ "$expected" != "$actual" ]; then
    echo "Error: Checksum verification failed" >&2
    echo "  Expected: $expected" >&2
    echo "  Actual:   $actual" >&2
    rm -f "${TMP_DIR}/${name}"
    exit 1
  fi

  echo "Checksum verified for ${name}"
}

# --- Install ---

install_binary() {
  local target="${INSTALL_DIR}/aop"

  cp "${TMP_DIR}/${BINARY_NAME}" "$target"
  chmod +x "$target"
  if [ "$OS" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
    # Downloading and replacing the standalone binary can leave macOS with an
    # invalid cached signature; an ad-hoc signature keeps launchd restarts alive.
    codesign --force --sign - "$target"
  fi

  if [ -n "$EXISTING_VERSION" ]; then
    echo "Upgraded AOP from $EXISTING_VERSION to $VERSION"
  else
    echo "Installed AOP $VERSION to $target"
  fi
}

install_runtime_assets() {
  if ! command -v tar >/dev/null 2>&1; then
    echo "Error: tar is required to install AOP runtime assets" >&2
    exit 1
  fi

  rm -rf "${INSTALL_DIR}/dashboard" "${INSTALL_DIR}/templates" "${INSTALL_DIR}/methodology"
  tar -xzf "${TMP_DIR}/${RUNTIME_ASSETS_NAME}" -C "$INSTALL_DIR"

  if [ ! -f "${INSTALL_DIR}/dashboard/index.html" ]; then
    echo "Error: dashboard assets were not installed correctly" >&2
    exit 1
  fi

  if [ ! -f "${INSTALL_DIR}/templates/codebase-research.md.hbs" ]; then
    echo "Error: prompt template assets were not installed correctly" >&2
    exit 1
  fi

  echo "Installed runtime assets to ${INSTALL_DIR}"
}

# --- Service Management ---

service_path() {
  printf '%s:%s:%s/.local/bin:%s/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
    "$INSTALL_DIR" "${PATH:-}" "$HOME" "$HOME"
}

stop_existing_service() {
  if [ "$OS" = "darwin" ]; then
    local plist="${HOME}/Library/LaunchAgents/${SERVICE_NAME}.plist"
    if command -v launchctl >/dev/null 2>&1; then
      launchctl unload "$plist" >/dev/null 2>&1 || true
    fi
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "${SYSTEMD_SERVICE_NAME}.service" >/dev/null 2>&1 || true
  fi

  if [ -x "${INSTALL_DIR}/aop" ]; then
    "${INSTALL_DIR}/aop" stop >/dev/null 2>&1 || true
  fi

  clear_local_server_port
}

clear_local_server_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(lsof -tiTCP:"$LOCAL_SERVER_PORT" -sTCP:LISTEN || true)"
  if [ -z "$pids" ]; then
    return
  fi

  kill $pids >/dev/null 2>&1 || true
  sleep 1

  pids="$(lsof -tiTCP:"$LOCAL_SERVER_PORT" -sTCP:LISTEN || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids >/dev/null 2>&1 || true
  fi
}

start_local_server() {
  mkdir -p "$LOG_DIR"

  if [ "$OS" = "darwin" ]; then
    install_launchd_service
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && install_systemd_service; then
    return
  fi

  echo "systemd user service unavailable; starting AOP in background"
  AOP_LOG_DIR="$LOG_DIR" \
  AOP_LOCAL_SERVER_PORT="$LOCAL_SERVER_PORT" \
  AOP_DASHBOARD_PORT="$DASHBOARD_PORT" \
  AOP_LOCAL_SERVER_URL="$LOCAL_SERVER_URL" \
  AOP_DASHBOARD_URL="$DASHBOARD_URL" \
  AOP_LICENSE_SERVER_URL="$LICENSE_SERVER_URL" \
  AOP_CHECKOUT_PRO_URL="$CHECKOUT_PRO_URL" \
  AOP_CHECKOUT_TEAM_URL="$CHECKOUT_TEAM_URL" \
  NODE_ENV="production" \
  PATH="$(service_path)" \
    "${INSTALL_DIR}/aop" run --background --port "$LOCAL_SERVER_PORT"
}

install_launchd_service() {
  local agents_dir="${HOME}/Library/LaunchAgents"
  local plist="${agents_dir}/${SERVICE_NAME}.plist"
  local env_path
  env_path="$(service_path)"

  mkdir -p "$agents_dir"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/aop</string>
    <string>run</string>
    <string>--port</string>
    <string>${LOCAL_SERVER_PORT}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AOP_LOG_DIR</key>
    <string>${LOG_DIR}</string>
    <key>AOP_LOCAL_SERVER_PORT</key>
    <string>${LOCAL_SERVER_PORT}</string>
    <key>AOP_DASHBOARD_PORT</key>
    <string>${DASHBOARD_PORT}</string>
    <key>AOP_LOCAL_SERVER_URL</key>
    <string>${LOCAL_SERVER_URL}</string>
    <key>AOP_DASHBOARD_URL</key>
    <string>${DASHBOARD_URL}</string>
    <key>AOP_LICENSE_SERVER_URL</key>
    <string>${LICENSE_SERVER_URL}</string>
    <key>AOP_CHECKOUT_PRO_URL</key>
    <string>${CHECKOUT_PRO_URL}</string>
    <key>AOP_CHECKOUT_TEAM_URL</key>
    <string>${CHECKOUT_TEAM_URL}</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>${env_path}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
EOF
  chmod 644 "$plist"
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load -w "$plist"
  echo "Started AOP local server with launchd"
}

install_systemd_service() {
  local systemd_dir="${HOME}/.config/systemd/user"
  local unit="${systemd_dir}/${SYSTEMD_SERVICE_NAME}.service"
  local env_path
  env_path="$(service_path)"

  mkdir -p "$systemd_dir"
  cat > "$unit" <<EOF
[Unit]
Description=AOP Local Server
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/aop run --port ${LOCAL_SERVER_PORT}
Environment=AOP_LOG_DIR=${LOG_DIR}
Environment=AOP_LOCAL_SERVER_PORT=${LOCAL_SERVER_PORT}
Environment=AOP_DASHBOARD_PORT=${DASHBOARD_PORT}
Environment=AOP_LOCAL_SERVER_URL=${LOCAL_SERVER_URL}
Environment=AOP_DASHBOARD_URL=${DASHBOARD_URL}
Environment=AOP_LICENSE_SERVER_URL=${LICENSE_SERVER_URL}
Environment=AOP_CHECKOUT_PRO_URL=${CHECKOUT_PRO_URL}
Environment=AOP_CHECKOUT_TEAM_URL=${CHECKOUT_TEAM_URL}
Environment=NODE_ENV=production
Environment=PATH=${env_path}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload >/dev/null 2>&1 || return 1
  systemctl --user enable --now "${SYSTEMD_SERVICE_NAME}.service" >/dev/null 2>&1 || return 1
  echo "Started AOP local server with systemd"
  return 0
}

wait_for_local_server() {
  local health_url="${LOCAL_SERVER_HEALTH_URL}/api/health"
  local attempts=30
  local i=0

  printf 'Waiting for AOP dashboard at %s' "$LOCAL_SERVER_URL"
  while [ "$i" -lt "$attempts" ]; do
    if http_get "$health_url" >/dev/null 2>&1; then
      echo ""
      echo "AOP local server is ready"
      return
    fi
    printf '.'
    i=$((i + 1))
    sleep 1
  done

  echo "" >&2
  echo "Error: AOP local server did not become ready at ${LOCAL_SERVER_URL}" >&2
  echo "Check logs at ${LOG_PATH}" >&2
  exit 1
}

# --- Post-Install Warnings ---

check_post_install_warnings() {
  local all_found=true

  # Warn if install dir is not on PATH
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo "Warning: ${INSTALL_DIR} is not on your PATH. Add it with:" >&2
      echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" >&2
      all_found=false
      ;;
  esac

  if [ "$all_found" = true ]; then
    echo "Post-install checks passed."
  fi
}

# --- Success Message ---

print_success() {
  echo ""
  echo "AOP $VERSION installed successfully!"
  echo "Dashboard: ${LOCAL_SERVER_URL}"
}

main "$@"
