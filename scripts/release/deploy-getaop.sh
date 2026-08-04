#!/usr/bin/env bash
# Upload release artifacts to getaop.com and point latest/version at the new release.
set -euo pipefail

VERSION="${1:?Usage: deploy-getaop.sh <version>}"
DEPLOY_HOST="${GETAOP_DEPLOY_HOST:-}"
DEPLOY_USER="${GETAOP_DEPLOY_USER:-}"
DEPLOY_PATH="${GETAOP_DEPLOY_PATH:-/var/www/getaop.com}"
RELEASE_DIR="${RELEASE_DIR:-dist/release}"
SSH_KEY_PATH="${GETAOP_DEPLOY_SSH_KEY_PATH:-$HOME/.ssh/getaop_deploy}"

if [ -z "$DEPLOY_HOST" ] || [ -z "$DEPLOY_USER" ]; then
  echo "Skipping getaop.com deploy: set GETAOP_DEPLOY_HOST and GETAOP_DEPLOY_USER to enable CDN publish."
  exit 0
fi

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Release directory not found: $RELEASE_DIR" >&2
  exit 1
fi

SSH_CMD=(ssh -o StrictHostKeyChecking=accept-new)
if [ -n "${GETAOP_DEPLOY_SSH_KEY:-}" ]; then
  mkdir -p "$(dirname "$SSH_KEY_PATH")"
  printf '%s\n' "$GETAOP_DEPLOY_SSH_KEY" > "$SSH_KEY_PATH"
  chmod 600 "$SSH_KEY_PATH"
  SSH_CMD+=(-i "$SSH_KEY_PATH")
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
REMOTE_VERSION_DIR="${DEPLOY_PATH}/v${VERSION}"
RSYNC_RSH="$(printf '%q ' "${SSH_CMD[@]}")"

echo "Deploying AOP ${VERSION} to ${REMOTE}:${REMOTE_VERSION_DIR}"

"${SSH_CMD[@]}" "$REMOTE" "mkdir -p '${REMOTE_VERSION_DIR}' '${DEPLOY_PATH}/latest'"

rsync -avz -e "$RSYNC_RSH" \
  "${RELEASE_DIR}/aop-linux-x64" \
  "${RELEASE_DIR}/aop-linux-arm64" \
  "${RELEASE_DIR}/aop-darwin-x64" \
  "${RELEASE_DIR}/aop-darwin-arm64" \
  "${RELEASE_DIR}/aop-macos-x64.dmg" \
  "${RELEASE_DIR}/aop-macos-arm64.dmg" \
  "${RELEASE_DIR}/aop-windows-x64.exe" \
  "${RELEASE_DIR}/aop-windows-x64-setup.exe" \
  "${RELEASE_DIR}/runtime-assets.tar.gz" \
  "${RELEASE_DIR}/checksums.sha256" \
  "${REMOTE}:${REMOTE_VERSION_DIR}/"

rsync -avz -e "$RSYNC_RSH" \
  scripts/installer/install.sh \
  scripts/installer/install.ps1 \
  docs/install/index.html \
  "${REMOTE}:${DEPLOY_PATH}/"

printf '%s' "$VERSION" | "${SSH_CMD[@]}" "$REMOTE" "cat > '${DEPLOY_PATH}/latest/version'"

echo "Deployed AOP ${VERSION}"
echo "Latest version URL: https://getaop.com/latest/version"
