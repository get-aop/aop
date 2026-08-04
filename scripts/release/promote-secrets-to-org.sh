#!/usr/bin/env bash
# Promote release secrets from the local environment (or interactive prompts)
# to the get-aop organization level, so every repo in the org inherits them.
#
# Run from a machine that holds the values (e.g. the Mac used for local
# releases). Requires a gh token with org admin on get-aop:
#   gh auth login   # with an account that is an owner/admin of get-aop
#
# Usage:
#   bash scripts/release/promote-secrets-to-org.sh
set -euo pipefail

ORG="${AOP_SECRETS_ORG:-get-aop}"

# Name -> friendly source hint. Values come from the environment first; when
# missing, the script prompts for them.
declare -A HINTS=(
  [AOP_MACOS_CERTIFICATE_P12_BASE64]="base64 of the Developer ID Application .p12 (export from Keychain: security export -k login.keychain-db -t certs -P '' -o cert.p12, then base64 -i cert.p12)"
  [AOP_MACOS_CERTIFICATE_PASSWORD]="password of the exported .p12"
  [AOP_MACOS_KEYCHAIN_PASSWORD]="optional: password for the CI keychain (any value works; skipped if unset)"
  [AOP_MACOS_SIGN_IDENTITY]="codesign identity, e.g. 'Developer ID Application: Your Name (TEAMID)'"
  [AOP_MACOS_NOTARIZE]="'1' to notarize DMGs, '0' otherwise"
  [APPLE_ID]="Apple ID used for notarization"
  [APPLE_TEAM_ID]="Apple Developer team id"
  [APPLE_APP_SPECIFIC_PASSWORD]="app-specific password for notarization"
  [CLOUDFLARE_API_TOKEN]="Cloudflare API token with R2 edit permission"
  [CLOUDFLARE_ACCOUNT_ID]="Cloudflare account id"
  [AOP_RELEASES_R2_BUCKET]="R2 bucket name for release assets"
)

read_value() {
  local name="$1"
  local value="${!name:-}"
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi
  local hint="${HINTS[$name]:-}"
  local prompt="Value for $name"
  [ -n "$hint" ] && prompt="$prompt ($hint)"
  if [ "$name" = "AOP_MACOS_KEYCHAIN_PASSWORD" ]; then
    echo ""
    return
  fi
  read -r -p "$prompt: " value
  echo "$value"
}

for name in "${!HINTS[@]}"; do
  value="$(read_value "$name")"
  if [ -z "$value" ]; then
    echo "== skipping $name (empty)"
    continue
  fi
  printf '%s' "$value" | gh secret set "$name" --org "$ORG"
  echo "== set $name at org level ($ORG)"
done

echo ""
echo "Done. Verify with: gh secret list --org $ORG"
echo "Repo-level secrets still shadow org-level ones where both exist (aop-mono keeps its own)."
