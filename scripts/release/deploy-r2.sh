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
  npx --yes wrangler@4 r2 object put "${BUCKET}/v${VERSION}/${name}" \
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

upload_object() {
  local key="$1"
  local source_path="$2"
  local content_type="$3"
  local cache_control="$4"

  echo "Uploading ${key} to R2 bucket ${BUCKET}/"
  npx --yes wrangler@4 r2 object put "${BUCKET}/${key}" \
    --file "$source_path" \
    --remote \
    --content-type "$content_type" \
    --cache-control "$cache_control"
}

verify_artifact_available() {
  local name="$1"
  local url="${PUBLIC_BASE}/v${VERSION}/${name}"
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

  echo "Release artifact never became publicly available: ${url}" >&2
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

# The host install script is this release's commit point. It carries the release's own version, so
# `curl .../install.sh | sh` installs exactly this release and no "latest version" file is needed.
# Publish it last so nobody is pointed at a release whose assets have not propagated yet.
INSTALL_SCRIPT="$(mktemp)"
trap 'rm -f "$INSTALL_SCRIPT"' EXIT
sed "s/^DEFAULT_VERSION=\"__AOP_VERSION__\"/DEFAULT_VERSION=\"${VERSION}\"/" "$SCRIPT_DIR/../installer/install.sh" > "$INSTALL_SCRIPT"
if ! grep -q "^DEFAULT_VERSION=\"${VERSION}\"" "$INSTALL_SCRIPT"; then
  echo "install.sh does not carry a DEFAULT_VERSION placeholder to stamp" >&2
  exit 1
fi
upload_object "install.sh" "$INSTALL_SCRIPT" "text/plain; charset=utf-8" "public, max-age=300, must-revalidate"

echo "Uploaded AOP ${VERSION} release artifacts to Cloudflare R2"
