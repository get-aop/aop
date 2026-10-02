#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: deploy-r2.sh <version>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_DIR="${RELEASE_DIR:-dist/release}"
BUCKET="${AOP_RELEASES_R2_BUCKET:-}"
PUBLIC_BASE="${AOP_RELEASES_PUBLIC_BASE_URL:-https://getaop.com}"
# Per-artifact verification window must outlive Cloudflare's ~5 minute negative
# cache: our own first probe can seed a cached 404 before the object propagates,
# so 24 x 15s (~6 minutes) guarantees at least one probe after that cache expires.
VERIFY_ATTEMPTS="${AOP_RELEASES_VERIFY_ATTEMPTS:-24}"
VERIFY_DELAY_SECONDS="${AOP_RELEASES_VERIFY_DELAY_SECONDS:-15}"
# Exact version: this runs with the Cloudflare token, so a new wrangler release must not run unreviewed.
WRANGLER="wrangler@4.146.0"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] || [ -z "$BUCKET" ]; then
  echo "Missing Cloudflare R2 deploy env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, AOP_RELEASES_R2_BUCKET" >&2
  exit 1
fi

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Release directory not found: $RELEASE_DIR" >&2
  exit 1
fi

# Records what actually got uploaded so pre-flip verification covers exactly
# this release's artifact set (required plus whichever optionals were present).
UPLOADED_ARTIFACTS=()

upload_artifact() {
  local name="$1"
  local content_type="$2"
  local cache_control="$3"
  local source_path="${RELEASE_DIR}/${name}"

  if [ ! -f "$source_path" ]; then
    echo "Release artifact not found: $source_path" >&2
    exit 1
  fi

  echo "Uploading ${name} to R2 bucket ${BUCKET}/v${VERSION}/"
  npx --yes "$WRANGLER" r2 object put "${BUCKET}/v${VERSION}/${name}" \
    --file "$source_path" \
    --remote \
    --content-type "$content_type" \
    --cache-control "$cache_control"
  UPLOADED_ARTIFACTS+=("$name")
}

upload_optional_artifact() {
  local name="$1"
  local content_type="$2"
  local cache_control="$3"
  if [ ! -f "${RELEASE_DIR}/${name}" ]; then
    echo "Skipping optional release artifact: ${name}"
    return
  fi
  upload_artifact "$name" "$content_type" "$cache_control"
}

upload_artifact "aop-linux-x64" "application/octet-stream" "public, max-age=31536000, immutable"
upload_artifact "aop-linux-arm64" "application/octet-stream" "public, max-age=31536000, immutable"
upload_artifact "aop-darwin-x64" "application/octet-stream" "public, max-age=31536000, immutable"
upload_artifact "aop-darwin-arm64" "application/octet-stream" "public, max-age=31536000, immutable"
upload_artifact "aop-macos-x64.dmg" "application/x-apple-diskimage" "public, max-age=31536000, immutable"
upload_artifact "aop-macos-arm64.dmg" "application/x-apple-diskimage" "public, max-age=31536000, immutable"
# A local release from a Mac cannot build the Windows desktop installer, so it may be absent.
upload_optional_artifact "aop-windows-x64-setup.exe" "application/octet-stream" "public, max-age=31536000, immutable"
upload_artifact "runtime-assets.tar.gz" "application/gzip" "public, max-age=31536000, immutable"
upload_artifact "checksums.sha256" "text/plain; charset=utf-8" "public, max-age=31536000, immutable"
# electron-updater fetches the blockmaps of the new and the installed version beside their
# installers to download only what changed (it falls back to the whole installer without them).
upload_optional_artifact "aop-windows-x64-setup.exe.blockmap" "application/octet-stream" "public, max-age=31536000, immutable"

upload_object() {
  local key="$1"
  local source_path="$2"
  local content_type="$3"
  local cache_control="$4"

  echo "Uploading ${key} to R2 bucket ${BUCKET}/"
  npx --yes "$WRANGLER" r2 object put "${BUCKET}/${key}" \
    --file "$source_path" \
    --remote \
    --content-type "$content_type" \
    --cache-control "$cache_control"
}

verify_artifact_available() {
  verify_url_available "${PUBLIC_BASE}/v${VERSION}/$1"
}

verify_url_available() {
  local url="$1"
  local attempt

  for ((attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++)); do
    if curl -fsSIL -o /dev/null "$url"; then
      echo "Verified public availability: ${url}"
      return 0
    fi
    if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
      echo "Not yet available (attempt ${attempt}/${VERIFY_ATTEMPTS}): ${url}; retrying in ${VERIFY_DELAY_SECONDS}s"
      sleep "$VERIFY_DELAY_SECONDS"
    fi
  done

  echo "Release file never became publicly available: ${url}" >&2
  return 1
}

# Everything below the versioned uploads is what people reach first, so it goes live only after
# every uploaded artifact is confirmed downloadable through the public CDN.
echo "Verifying public availability of v${VERSION} artifacts before publishing the install script"
for name in "${UPLOADED_ARTIFACTS[@]}"; do
  verify_artifact_available "$name"
done

# Durable download URLs for the desktop apps (people paste these into chat, the install page links
# to them). They are copies of files already verified above, not a version feed.
upload_latest_alias() {
  local name="$1"
  local content_type="$2"
  if [ ! -f "${RELEASE_DIR}/${name}" ]; then
    return
  fi
  upload_object "latest/${name}" "${RELEASE_DIR}/${name}" "$content_type" "public, max-age=300, must-revalidate"
}

upload_latest_alias "aop-macos-arm64.dmg" "application/x-apple-diskimage"
upload_latest_alias "aop-macos-x64.dmg" "application/x-apple-diskimage"
upload_latest_alias "aop-windows-x64-setup.exe" "application/octet-stream"

# The release feed (scripts/release/release-feed.ts): every updater reads it, because the GitHub
# repository is private. The versioned documents go up and are probed first; then the pointers
# flip: releases/latest.json (the host, `aop update` and the macOS app), its GitHub-shaped copy
# (what AOP 0.10.0 to 0.10.4 read when pointed here) and latest/latest.yml (the Windows app).
FEED_DIR="$(mktemp -d)"
INSTALL_SCRIPT="$(mktemp)"
trap 'rm -rf "$FEED_DIR" "$INSTALL_SCRIPT"' EXIT
NOTES_FILE="${AOP_RELEASE_NOTES_FILE:-dist/release-notes.md}"
bun "$SCRIPT_DIR/release-feed.ts" --dir "$RELEASE_DIR" --version "$VERSION" \
  --notes-file "$NOTES_FILE" --published-at "${AOP_RELEASE_PUBLISHED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
  --origin "$PUBLIC_BASE" --out "$FEED_DIR"

upload_feed_document() {
  local key="$1"
  local content_type="$2"
  upload_object "$key" "${FEED_DIR}/${key}" "$content_type" "public, max-age=300, must-revalidate"
}

upload_feed_document "releases/v${VERSION}.json" "application/json"
upload_feed_document "releases/v${VERSION}.md" "text/plain; charset=utf-8"
verify_url_available "${PUBLIC_BASE}/releases/v${VERSION}.json"
verify_url_available "${PUBLIC_BASE}/releases/v${VERSION}.md"

if [ -f "${FEED_DIR}/latest/latest.yml" ]; then
  upload_feed_document "latest/latest.yml" "text/yaml; charset=utf-8"
fi
upload_feed_document "repos/get-aop/aop-mono/releases/latest" "application/json"
upload_feed_document "releases/latest.json" "application/json"

# AOP 0.9 read this file and nothing has written it since; a stale version there misleads
# whoever reads it, so it goes. Deleting a key that is already gone is not an error.
echo "Removing the retired latest/version pointer"
npx --yes "$WRANGLER" r2 object delete "${BUCKET}/latest/version" --remote || true

# The host install script is this release's commit point. It carries the release's own version, so
# `curl .../install.sh | sh` installs exactly this release and no "latest version" file is needed.
# Publish it last so nobody is pointed at a release whose assets have not propagated yet.
sed "s/^DEFAULT_VERSION=\"__AOP_VERSION__\"/DEFAULT_VERSION=\"${VERSION}\"/" "$SCRIPT_DIR/../installer/install.sh" > "$INSTALL_SCRIPT"
if ! grep -q "^DEFAULT_VERSION=\"${VERSION}\"" "$INSTALL_SCRIPT"; then
  echo "install.sh does not carry a DEFAULT_VERSION placeholder to stamp" >&2
  exit 1
fi
upload_object "install.sh" "$INSTALL_SCRIPT" "text/plain; charset=utf-8" "public, max-age=300, must-revalidate"

echo "Uploaded AOP ${VERSION} release artifacts to Cloudflare R2"
