#!/bin/sh
# AOP host install script: download the host (macOS or Linux), put `aop` on PATH, and start it
# as a background user service (launchd or systemd). Windows is desktop-app only and has no host.
#
# Usage: curl -fsSL https://getaop.com/install.sh | sh
#        curl -fsSL https://getaop.com/install.sh | sh -s -- --prefix /custom/path --version 0.2.0
#        curl -fsSL https://getaop.com/install.sh | sh -s -- --no-service
#
# The release workflow replaces the placeholder below with the release's own version when it
# publishes this file, so the copy on getaop.com installs that release and no "latest version"
# file has to exist. An unstamped copy (a checkout) needs --version.
#
# AOP Nightly (docs/NIGHTLY.md): curl -fsSL https://getaop.com/nightly/install.sh | sh
# That copy has CHANNEL stamped "nightly". It installs `aop-nightly` beside the stable `aop`, with
# its own folder, data, port and service, and leaves the stable install alone. A nightly install
# reads only AOP_NIGHTLY_* overrides: a shell inside a stable AOP thread carries stable's
# AOP_LOCAL_SERVER_PORT, and honouring it would stop the stable host.
set -eu

DEFAULT_VERSION="__AOP_VERSION__"
CHANNEL="__AOP_CHANNEL__"
RUNTIME_ASSETS_NAME="runtime-assets.tar.gz"
AOP_GITHUB_REPO="${AOP_GITHUB_REPO:-get-aop/aop}"
if [ "$CHANNEL" = "nightly" ]; then
  PRODUCT_NAME="AOP Nightly"
  BIN_NAME="aop-nightly"
  DATA_DIR="${HOME}/.aop-nightly"
  INSTALL_PAGE="https://getaop.com/nightly/install.sh"
  RELEASES_BASE_URL="${AOP_NIGHTLY_RELEASES_URL:-https://getaop.com/nightly}"
  LOCAL_SERVER_PORT="${AOP_NIGHTLY_LOCAL_SERVER_PORT:-25650}"
  DASHBOARD_PORT="${AOP_NIGHTLY_DASHBOARD_PORT:-25660}"
  LOCAL_SERVER_URL="http://aop.localhost:${LOCAL_SERVER_PORT}"
  DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"
  LOG_DIR="${DATA_DIR}/logs"
  SERVICE_NAME="com.aop.local-server.nightly"
  SYSTEMD_SERVICE_NAME="aop-nightly-local-server"
else
  CHANNEL="stable"
  PRODUCT_NAME="AOP"
  BIN_NAME="aop"
  DATA_DIR="${HOME}/.aop"
  INSTALL_PAGE="https://getaop.com/install.sh"
  RELEASES_BASE_URL="${AOP_RELEASES_URL:-https://getaop.com}"
  LOCAL_SERVER_PORT="${AOP_LOCAL_SERVER_PORT:-25150}"
  DASHBOARD_PORT="${AOP_DASHBOARD_PORT:-25160}"
  LOCAL_SERVER_URL="${AOP_LOCAL_SERVER_URL:-http://aop.localhost:${LOCAL_SERVER_PORT}}"
  DASHBOARD_URL="${AOP_DASHBOARD_URL:-http://localhost:${DASHBOARD_PORT}}"
  LOG_DIR="${AOP_LOG_DIR:-${DATA_DIR}/logs}"
  SERVICE_NAME="com.aop.local-server"
  SYSTEMD_SERVICE_NAME="aop-local-server"
fi
LOCAL_SERVER_HEALTH_URL="http://127.0.0.1:${LOCAL_SERVER_PORT}"
LOG_PATH="${LOG_DIR}/local-server.log"

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
  link_nightly_command
  setup_computer_use
  start_local_server
  wait_for_local_server
  check_post_install_warnings
  print_success
}

# --- Argument Parsing ---

PREFIX=""
VERSION=""
# --no-service (or AOP_INSTALL_NO_SERVICE=1) installs the files and leaves launchd, systemd and
# any running server alone. Start the host yourself with `aop run`.
NO_SERVICE=""
case "${AOP_INSTALL_NO_SERVICE:-}" in
  1|true|yes) NO_SERVICE="1" ;;
esac
# --no-computer-use (or AOP_INSTALL_NO_COMPUTER_USE=1) leaves CUA Driver and the screen alone.
# Set them up later with `aop computer-use setup`.
NO_COMPUTER_USE=""
case "${AOP_INSTALL_NO_COMPUTER_USE:-}" in
  1|true|yes) NO_COMPUTER_USE="1" ;;
esac

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
      --no-service)
        NO_SERVICE="1"
        shift
        ;;
      --no-computer-use)
        NO_COMPUTER_USE="1"
        shift
        ;;
      *)
        echo "Unknown argument: $1" >&2
        echo "Usage: install.sh [--prefix <dir>] [--version <version>] [--no-service] [--no-computer-use]" >&2
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
      echo "The AOP host runs on macOS and Linux. On Windows, install the desktop app and" >&2
      echo "connect it to a host running on a Mac or Linux machine." >&2
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
    Fix: install and sign in to Claude Code (claude)"
  fi

  if [ -n "$issues" ]; then
    echo "AOP preflight checks failed." >&2
    echo "" >&2
    echo "AOP needs GitHub access and at least one local coding runtime before install." >&2
    printf '%s\n' "$issues" >&2
    echo "" >&2
    echo "After fixing the items above, rerun:" >&2
    echo "  curl -fsSL ${INSTALL_PAGE} | sh" >&2
    echo "" >&2
    echo "Advanced users can bypass this check with:" >&2
    echo "  curl -fsSL ${INSTALL_PAGE} | AOP_SKIP_PREFLIGHT=1 sh" >&2
    exit 1
  fi

  echo "AOP preflight checks passed."
}

has_supported_runtime_cli() {
  command -v claude >/dev/null 2>&1
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

  if [ "$DEFAULT_VERSION" = "__AOP_VERSION__" ]; then
    echo "Error: this copy of install.sh is not tied to a release. Pass --version <x.y.z>," >&2
    echo "or use the copy published with a release: curl -fsSL ${INSTALL_PAGE} | sh" >&2
    exit 1
  fi

  VERSION="$DEFAULT_VERSION"
  echo "Installing ${PRODUCT_NAME} $VERSION"
}

# --- Install Directory ---

INSTALL_DIR=""

resolve_install_dir() {
  if [ -n "$PREFIX" ]; then
    INSTALL_DIR="${PREFIX}/bin"
  elif [ "$CHANNEL" = "nightly" ]; then
    # Its own folder: the dashboard unpacks beside the binary, and stable's is in ~/.local/bin.
    INSTALL_DIR="${DATA_DIR}/bin"
  elif [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
  fi

  mkdir -p "$INSTALL_DIR"
}

# --- Existing Installation Check ---

EXISTING_VERSION=""

# The bare release version an installed binary reports. It prints
# `aop/<version>[+<commit>] <platform> <runtime>` (`aop-nightly/…` for AOP Nightly), and the
# release version has no commit.
installed_version() {
  local printed
  printed="$("$1" --version 2>/dev/null || true)"
  printed="${printed#*/}"
  printed="${printed%% *}"
  printf '%s' "${printed%%+*}"
}

check_existing_installation() {
  local existing_bin="${INSTALL_DIR}/${BIN_NAME}"

  if [ -x "$existing_bin" ]; then
    EXISTING_VERSION="$(installed_version "$existing_bin")"
    if [ "$EXISTING_VERSION" = "$VERSION" ]; then
      echo "${PRODUCT_NAME} $VERSION is already installed; refreshing assets and service"
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
    no_github_fallback "checksums.sha256"
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
    no_github_fallback "$name"
    echo "Primary CDN miss — trying GitHub Releases..."
    asset_url="$(github_release_asset_url "$name")"
    http_download "$asset_url" "${TMP_DIR}/${name}" || {
      echo "Error: Failed to download ${name} from getaop.com or GitHub Releases" >&2
      exit 1
    }
  fi
}

# Nightlies are published on getaop.com only, never as GitHub releases.
no_github_fallback() {
  if [ "$CHANNEL" = "nightly" ]; then
    echo "Error: Failed to download $1 from ${RELEASES_BASE_URL}/v${VERSION}/" >&2
    exit 1
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
  local target="${INSTALL_DIR}/${BIN_NAME}"

  cp "${TMP_DIR}/${BINARY_NAME}" "$target"
  chmod +x "$target"
  if [ "$OS" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
    # Downloading and replacing the standalone binary can leave macOS with an
    # invalid cached signature; an ad-hoc signature keeps launchd restarts alive.
    codesign --force --sign - "$target"
  fi

  if [ "$EXISTING_VERSION" = "$VERSION" ]; then
    echo "Reinstalled ${PRODUCT_NAME} $VERSION at $target"
  elif [ -n "$EXISTING_VERSION" ]; then
    echo "Upgraded ${PRODUCT_NAME} from $EXISTING_VERSION to $VERSION"
  else
    echo "Installed ${PRODUCT_NAME} $VERSION to $target"
  fi
}

install_runtime_assets() {
  if ! command -v tar >/dev/null 2>&1; then
    echo "Error: tar is required to install AOP runtime assets" >&2
    exit 1
  fi

  rm -rf "${INSTALL_DIR}/dashboard"
  tar -xzf "${TMP_DIR}/${RUNTIME_ASSETS_NAME}" -C "$INSTALL_DIR"

  if [ ! -f "${INSTALL_DIR}/dashboard/index.html" ]; then
    echo "Error: dashboard assets were not installed correctly" >&2
    exit 1
  fi

  echo "Installed runtime assets to ${INSTALL_DIR}"
}

# AOP Nightly lives in its own folder; a small launcher in ~/.local/bin puts `aop-nightly` on
# PATH. A launcher rather than a symlink, so the host always runs from its real path, which is
# what its updater and its service files name.
COMMAND_DIR=""

link_nightly_command() {
  COMMAND_DIR="$INSTALL_DIR"
  if [ "$CHANNEL" != "nightly" ] || [ -n "$PREFIX" ]; then
    return
  fi
  COMMAND_DIR="${HOME}/.local/bin"
  mkdir -p "$COMMAND_DIR"
  printf '#!/bin/sh\nexec "%s" "$@"\n' "${INSTALL_DIR}/${BIN_NAME}" > "${COMMAND_DIR}/${BIN_NAME}"
  chmod +x "${COMMAND_DIR}/${BIN_NAME}"
  echo "Linked ${COMMAND_DIR}/${BIN_NAME}"
}

# --- Computer Use ---

# Threads use the host's screen through CUA Driver, which AOP installs at the version it pins,
# with (on Linux) a virtual display that starts at boot. `aop computer-use setup` does it and can
# be run again any time. Packages that need root are never installed silently: from a terminal
# setup shows the one sudo command and asks before running it; otherwise it only prints it. A
# setup that cannot finish never fails the AOP install.
setup_computer_use() {
  if [ -n "$NO_COMPUTER_USE" ]; then
    echo "Skipping computer use setup (--no-computer-use). Run later: ${BIN_NAME} computer-use setup"
    return
  fi
  local bin="${INSTALL_DIR}/${BIN_NAME}"
  local rc=0
  echo "Setting up computer use (CUA Driver)..."
  # From `curl | sh`, stdin is the script itself, so questions and sudo read the terminal.
  if [ -t 1 ] && (exec </dev/tty) 2>/dev/null; then
    "$bin" computer-use setup </dev/tty || rc=$?
  else
    "$bin" computer-use setup --no-sudo </dev/null || rc=$?
  fi
  case "$rc" in
    0) ;;
    2) echo "Computer use is not ready yet (see above). Threads run without it until it is; check with: ${BIN_NAME} computer-use status" >&2 ;;
    *) echo "Warning: computer use setup did not finish. Run it again later: ${BIN_NAME} computer-use setup" >&2 ;;
  esac
}

# --- Service Management ---

service_path() {
  printf '%s:%s:%s/.local/bin:%s/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
    "$INSTALL_DIR" "${PATH:-}" "$HOME" "$HOME"
}

stop_existing_service() {
  if [ -n "$NO_SERVICE" ]; then
    return
  fi

  if [ "$OS" = "darwin" ]; then
    local plist="${HOME}/Library/LaunchAgents/${SERVICE_NAME}.plist"
    if command -v launchctl >/dev/null 2>&1; then
      launchctl unload "$plist" >/dev/null 2>&1 || true
    fi
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "${SYSTEMD_SERVICE_NAME}.service" >/dev/null 2>&1 || true
  fi

  if [ -x "${INSTALL_DIR}/${BIN_NAME}" ]; then
    "${INSTALL_DIR}/${BIN_NAME}" stop >/dev/null 2>&1 || true
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
  if [ -n "$NO_SERVICE" ]; then
    echo "Skipping the background service (--no-service); start the host with: ${INSTALL_DIR}/${BIN_NAME} run"
    return
  fi

  mkdir -p "$LOG_DIR"

  if [ "$OS" = "darwin" ]; then
    install_launchd_service
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && install_systemd_service; then
    return
  fi

  echo "systemd user service unavailable; starting ${PRODUCT_NAME} in background"
  AOP_LOG_DIR="$LOG_DIR" \
  AOP_LOCAL_SERVER_PORT="$LOCAL_SERVER_PORT" \
  AOP_DASHBOARD_PORT="$DASHBOARD_PORT" \
  AOP_LOCAL_SERVER_URL="$LOCAL_SERVER_URL" \
  AOP_DASHBOARD_URL="$DASHBOARD_URL" \
  NODE_ENV="production" \
  PATH="$(service_path)" \
    "${INSTALL_DIR}/${BIN_NAME}" run --background --port "$LOCAL_SERVER_PORT"
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
    <string>${INSTALL_DIR}/${BIN_NAME}</string>
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
  echo "Started ${PRODUCT_NAME} local server with launchd"
}

install_systemd_service() {
  local systemd_dir="${HOME}/.config/systemd/user"
  local unit="${systemd_dir}/${SYSTEMD_SERVICE_NAME}.service"
  local env_path
  env_path="$(service_path)"

  mkdir -p "$systemd_dir"
  cat > "$unit" <<EOF
[Unit]
Description=${PRODUCT_NAME} Local Server
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${BIN_NAME} run --port ${LOCAL_SERVER_PORT}
Environment=AOP_LOG_DIR=${LOG_DIR}
Environment=AOP_LOCAL_SERVER_PORT=${LOCAL_SERVER_PORT}
Environment=AOP_DASHBOARD_PORT=${DASHBOARD_PORT}
Environment=AOP_LOCAL_SERVER_URL=${LOCAL_SERVER_URL}
Environment=AOP_DASHBOARD_URL=${DASHBOARD_URL}
Environment=NODE_ENV=production
Environment=PATH=${env_path}
# Agent runs are detached processes that outlive the server: a restart (an update, a crash)
# stops only the server, and the next one picks the runs up. Without this, systemd would stop
# every process the server started.
KillMode=process
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload >/dev/null 2>&1 || return 1
  systemctl --user enable --now "${SYSTEMD_SERVICE_NAME}.service" >/dev/null 2>&1 || return 1
  echo "Started ${PRODUCT_NAME} local server with systemd"
  return 0
}

wait_for_local_server() {
  if [ -n "$NO_SERVICE" ]; then
    return
  fi

  local health_url="${LOCAL_SERVER_HEALTH_URL}/api/health"
  local attempts=30
  local i=0

  printf 'Waiting for %s dashboard at %s' "$PRODUCT_NAME" "$LOCAL_SERVER_URL"
  while [ "$i" -lt "$attempts" ]; do
    if http_get "$health_url" >/dev/null 2>&1; then
      echo ""
      echo "${PRODUCT_NAME} local server is ready"
      return
    fi
    printf '.'
    i=$((i + 1))
    sleep 1
  done

  echo "" >&2
  echo "Error: ${PRODUCT_NAME} local server did not become ready at ${LOCAL_SERVER_URL}" >&2
  echo "Check logs at ${LOG_PATH}" >&2
  exit 1
}

# --- Post-Install Warnings ---

check_post_install_warnings() {
  local all_found=true

  # `aop` only runs by name when its folder is on PATH. Say exactly what to add when it is not.
  case ":${PATH}:" in
    *":${COMMAND_DIR}:"*) ;;
    *)
      echo "Warning: ${COMMAND_DIR} is not on your PATH, so \`${BIN_NAME}\` will not be found by name." >&2
      echo "Add this line to your shell profile (~/.zshrc or ~/.bashrc), then open a new terminal:" >&2
      echo "  export PATH=\"${COMMAND_DIR}:\$PATH\"" >&2
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
  echo "${PRODUCT_NAME} $VERSION installed successfully!"
  if [ -n "$NO_SERVICE" ]; then
    # Nothing was started, so a dashboard address here would point at a host that is not running.
    echo "Start the host with: ${INSTALL_DIR}/${BIN_NAME} run"
    echo "Then open the dashboard at ${LOCAL_SERVER_URL}"
  else
    echo "Dashboard: ${LOCAL_SERVER_URL}"
  fi
  print_next_steps
}

# Where to go from here: other devices, remote access and updates. The tailscale command is the
# one AOP settings › Host shows; AOP Nightly serves https on its own port, so 443 stays stable's.
print_next_steps() {
  local https_port=443
  if [ "$CHANNEL" = "nightly" ]; then
    https_port="$LOCAL_SERVER_PORT"
  fi
  echo ""
  echo "Pair another device: run \`${BIN_NAME} pair\` on this computer and enter the code in the AOP app or a browser."
  echo "Reach it from your other devices over Tailscale: tailscale serve --bg --https=${https_port} http://127.0.0.1:${LOCAL_SERVER_PORT}"
  echo "Updates: AOP settings › Updates. Setup status: AOP settings › Host."
}

main "$@"
