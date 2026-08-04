# Releasing AOP

One command from a clean checkout on `main`:

```bash
bun run release patch
```

That bumps the version in the root `package.json` (the single source of truth for the AOP version), runs `bun check`, commits, tags `vX.Y.Z`, and pushes. GitHub Actions then builds binaries, publishes the GitHub Release, and deploys to getaop.com when deploy secrets are configured.

## Commands

| Command | Example |
|---------|---------|
| Patch bump | `bun run release patch` |
| Minor bump | `bun run release minor` |
| Major bump | `bun run release major` |
| Explicit version | `bun run release 0.2.0` |
| Preview only | `bun run release patch --dry-run` |
| Skip checks | `bun run release patch --skip-check` |
| Commit/tag locally, push yourself | `bun run release patch --no-push` |

## Prerequisites

- Clean git working tree
- `main` merged and up to date with the release you want to ship
- GitHub repo secrets for CDN deploy (one-time setup):

| Secret | Purpose |
|--------|---------|
| `GETAOP_DEPLOY_HOST` | VPS hostname for getaop.com |
| `GETAOP_DEPLOY_USER` | SSH user with write access to the web root |
| `GETAOP_DEPLOY_SSH_KEY` | Private key for that user |
| `GETAOP_DEPLOY_PATH` | Optional. Defaults to `/var/www/getaop.com` |

## What users see after release

- `curl -fsSL https://getaop.com/install.sh | sh` installs the new version
- macOS DMG downloads are available at `https://getaop.com/vX.Y.Z/aop-macos-arm64.dmg` and `https://getaop.com/vX.Y.Z/aop-macos-x64.dmg`
- Windows desktop setup (`aop-windows-x64-setup.exe`) is attached automatically after the primary release finishes; durable URL: `https://getaop.com/latest/aop-windows-x64-setup.exe`
- Native Windows CLI install: `irm https://getaop.com/install.ps1 | iex`
- Dashboard **Update available** button appears for binary installs on older versions
- Existing `~/.aop/` data is preserved; users restart with `aop stop && aop run --background`

## macOS Desktop DMGs

Release CI builds two Tauri desktop disk images:

| Artifact | Target |
|----------|--------|
| `aop-macos-arm64.dmg` | Apple silicon Macs |
| `aop-macos-x64.dmg` | Intel Macs |

The DMG contains `AOP.app`. Opening it shows a setup-first desktop window, verifies Git, GitHub CLI auth, and at least one supported runtime, then starts the bundled AOP sidecar and loads the dashboard inside the app. The app stores data in `~/.aop`, like the curl-installed binary.

Unsigned DMGs work without an Apple Developer Program account:

```bash
bun run build:release
bun run package:macos-dmg
hdiutil verify dist/release/aop-macos-arm64.dmg
```

The packaging command uses Tauri and Rust. The local machine or CI runner needs the stable Rust toolchain available.

macOS will show Gatekeeper warnings until the app is signed and notarized. Configure these GitHub secrets for public distribution:

| Secret | Purpose |
|--------|---------|
| `AOP_MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application `.p12` certificate |
| `AOP_MACOS_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate |
| `AOP_MACOS_SIGN_IDENTITY` | Codesign identity, for example `Developer ID Application: Example Inc (TEAMID)` |
| `AOP_MACOS_NOTARIZE` | Set to `1` to submit DMGs to Apple notarization |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `AOP_MACOS_KEYCHAIN_PASSWORD` | Optional temporary CI keychain password |

For a local signed build, import the certificate into your keychain and run:

```bash
AOP_MACOS_SIGN_IDENTITY="Developer ID Application: Example Inc (TEAMID)" \
  bun run package:macos-dmg
```

To notarize locally, add `AOP_MACOS_NOTARIZE=1`, `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`.

## Troubleshooting

- **Tag already exists**: delete the local tag or pick a new version
- **CI did not deploy to getaop.com**: add the deploy secrets above, then re-run the Release workflow or deploy manually with `scripts/release/deploy-getaop.sh`
- **Only GitHub Release, no CDN**: expected until deploy secrets are configured; install script still works via GitHub Releases fallback
- **DMG opens with an unidentified developer warning**: expected for unsigned builds. Configure Developer ID signing and notarization secrets before public distribution.

See also: [`scripts/installer/DEPLOY.md`](../scripts/installer/DEPLOY.md)
