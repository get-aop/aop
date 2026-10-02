#!/usr/bin/env bash
# Publishes one AOP Nightly build to getaop.com/nightly/ (docs/NIGHTLY.md). The stable release
# is deploy-r2.sh; nothing here writes outside the nightly/ prefix, and it runs with a key scoped
# to the nightly bucket, which cannot reach stable's.
#
# Order, as in deploy-r2.sh: the versioned files, a public probe of each, the download aliases,
# the feed (versioned documents first, then the pointers), the index, install.sh last, and then
# the files of builds past the newest AOP_NIGHTLY_KEEP are deleted.
#
# AOP_NIGHTLY_DRY_RUN=1 prints every upload and deletion instead of making it, reads nothing
# from the network, and needs no credentials: the workflow's build-only runs use it.
set -euo pipefail

VERSION="${1:?Usage: deploy-nightly.sh <version> <commit>}"
COMMIT="${2:?Usage: deploy-nightly.sh <version> <commit>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_DIR="${RELEASE_DIR:-dist/release}"
PUBLIC_BASE="${AOP_NIGHTLY_PUBLIC_BASE_URL:-https://getaop.com}"
PREFIX="nightly"
KEEP="${AOP_NIGHTLY_KEEP:-10}"
DRY_RUN="${AOP_NIGHTLY_DRY_RUN:-}"
BUCKET="${AOP_NIGHTLY_R2_BUCKET:-aop-nightly}"
VERIFY_ATTEMPTS="${AOP_RELEASES_VERIFY_ATTEMPTS:-24}"
VERIFY_DELAY_SECONDS="${AOP_RELEASES_VERIFY_DELAY_SECONDS:-15}"
IMMUTABLE="public, max-age=31536000, immutable"
SHORT="public, max-age=300, must-revalidate"

# Every file of a nightly. No Windows build: nightly is for the maintainer's Mac (and Linux hosts).
ARTIFACTS=(
  "aop-linux-x64:application/octet-stream"
  "aop-linux-arm64:application/octet-stream"
  "aop-darwin-x64:application/octet-stream"
  "aop-darwin-arm64:application/octet-stream"
  "aop-macos-x64.dmg:application/x-apple-diskimage"
  "aop-macos-arm64.dmg:application/x-apple-diskimage"
  "aop-macos-x64.zip:application/zip"
  "aop-macos-arm64.zip:application/zip"
  "runtime-assets.tar.gz:application/gzip"
  "checksums.sha256:text/plain; charset=utf-8"
)

if [ -z "$DRY_RUN" ]; then
  if [ -z "${AOP_NIGHTLY_R2_ACCESS_KEY_ID:-}" ] || [ -z "${AOP_NIGHTLY_R2_SECRET_ACCESS_KEY:-}" ] ||
    [ -z "${AOP_NIGHTLY_R2_ENDPOINT:-}" ] || [ -z "${AOP_NIGHTLY_R2_BUCKET:-}" ]; then
    echo "Missing nightly R2 env: AOP_NIGHTLY_R2_ACCESS_KEY_ID, AOP_NIGHTLY_R2_SECRET_ACCESS_KEY, AOP_NIGHTLY_R2_ENDPOINT, AOP_NIGHTLY_R2_BUCKET" >&2
    exit 1
  fi
  # R2's S3 API with a key scoped to the nightly bucket. R2 does not take the checksums newer
  # AWS CLIs send by default.
  export AWS_ACCESS_KEY_ID="$AOP_NIGHTLY_R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$AOP_NIGHTLY_R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  export AWS_REQUEST_CHECKSUM_CALCULATION="when_required"
  export AWS_RESPONSE_CHECKSUM_VALIDATION="when_required"
fi

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Release directory not found: $RELEASE_DIR" >&2
  exit 1
fi

s3() {
  if [ -n "$DRY_RUN" ]; then
    echo "dry-run: aws s3 $*"
    return 0
  fi
  aws s3 "$@" --endpoint-url "$AOP_NIGHTLY_R2_ENDPOINT" --only-show-errors
}

upload() {
  local key="$1" source="$2" content_type="$3" cache_control="$4"
  echo "Uploading ${PREFIX}/${key}"
  s3 cp "$source" "s3://${BUCKET}/${PREFIX}/${key}" --content-type "$content_type" --cache-control "$cache_control"
}

verify_url_available() {
  local url="$1" attempt
  if [ -n "$DRY_RUN" ]; then
    echo "dry-run: probe ${url}"
    return 0
  fi
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
  echo "Nightly file never became publicly available: ${url}" >&2
  return 1
}

for name in "${ARTIFACTS[@]%%:*}" latest-mac.yml; do
  if [ ! -s "${RELEASE_DIR}/${name}" ]; then
    echo "Nightly artifact missing or empty: ${RELEASE_DIR}/${name}" >&2
    exit 1
  fi
done

for entry in "${ARTIFACTS[@]}"; do
  upload "v${VERSION}/${entry%%:*}" "${RELEASE_DIR}/${entry%%:*}" "${entry#*:}" "$IMMUTABLE"
done

echo "Verifying public availability of nightly ${VERSION} before anything points at it"
for entry in "${ARTIFACTS[@]}"; do
  verify_url_available "${PUBLIC_BASE}/${PREFIX}/v${VERSION}/${entry%%:*}"
done

upload "latest/aop-macos-arm64.dmg" "${RELEASE_DIR}/aop-macos-arm64.dmg" "application/x-apple-diskimage" "$SHORT"
upload "latest/aop-macos-x64.dmg" "${RELEASE_DIR}/aop-macos-x64.dmg" "application/x-apple-diskimage" "$SHORT"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
FEED_DIR="${WORK_DIR}/feed"
NOTES_FILE="${AOP_RELEASE_NOTES_FILE:-dist/release-notes.md}"
bun "$SCRIPT_DIR/release-feed.ts" --dir "$RELEASE_DIR" --version "$VERSION" --channel nightly \
  --commit "$COMMIT" --notes-file "$NOTES_FILE" \
  --published-at "${AOP_RELEASE_PUBLISHED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
  --origin "${PUBLIC_BASE}/${PREFIX}" --out "$FEED_DIR"

upload "releases/v${VERSION}.json" "${FEED_DIR}/releases/v${VERSION}.json" "application/json" "$SHORT"
upload "releases/v${VERSION}.md" "${FEED_DIR}/releases/v${VERSION}.md" "text/plain; charset=utf-8" "$SHORT"
verify_url_available "${PUBLIC_BASE}/${PREFIX}/releases/v${VERSION}.json"
verify_url_available "${PUBLIC_BASE}/${PREFIX}/releases/v${VERSION}.md"

# The pointers: a signed AOP Nightly.app updates from latest-mac.yml, nightly hosts and the app's
# notice read latest.json.
upload "latest/latest-mac.yml" "${FEED_DIR}/latest/latest-mac.yml" "text/yaml; charset=utf-8" "$SHORT"
upload "releases/latest.json" "${FEED_DIR}/releases/latest.json" "application/json" "$SHORT"

# The index of published builds, read back from the bucket (not the CDN, which may be behind).
INDEX="${WORK_DIR}/index.json"
if [ -z "$DRY_RUN" ]; then
  s3 cp "s3://${BUCKET}/${PREFIX}/releases/index.json" "$INDEX" >/dev/null 2>&1 || true
fi
PRUNE="$(bun "$SCRIPT_DIR/nightly-index.ts" --index "$INDEX" --version "$VERSION" --commit "$COMMIT" \
  --keep "$KEEP" --out "${WORK_DIR}/index.next.json")"
upload "releases/index.json" "${WORK_DIR}/index.next.json" "application/json" "$SHORT"

# install.sh is the commit point: stamped with this build and the nightly channel, uploaded last.
INSTALL_SCRIPT="${WORK_DIR}/install.sh"
sed -e "s/^DEFAULT_VERSION=\"__AOP_VERSION__\"/DEFAULT_VERSION=\"${VERSION}\"/" \
  -e 's/^CHANNEL="__AOP_CHANNEL__"/CHANNEL="nightly"/' \
  "$SCRIPT_DIR/../installer/install.sh" > "$INSTALL_SCRIPT"
if ! grep -q "^DEFAULT_VERSION=\"${VERSION}\"" "$INSTALL_SCRIPT" || ! grep -q '^CHANNEL="nightly"' "$INSTALL_SCRIPT"; then
  echo "install.sh does not carry the DEFAULT_VERSION and CHANNEL placeholders to stamp" >&2
  exit 1
fi
upload "install.sh" "$INSTALL_SCRIPT" "text/plain; charset=utf-8" "$SHORT"

# Retention: only now, once nothing points at them any more.
for old in $PRUNE; do
  echo "Deleting nightly ${old} (past the newest ${KEEP})"
  s3 rm "s3://${BUCKET}/${PREFIX}/v${old}/" --recursive
  s3 rm "s3://${BUCKET}/${PREFIX}/releases/v${old}.json"
  s3 rm "s3://${BUCKET}/${PREFIX}/releases/v${old}.md"
done

echo "Published AOP Nightly ${VERSION} (${COMMIT}) to ${PUBLIC_BASE}/${PREFIX}/"
