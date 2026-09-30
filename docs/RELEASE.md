# Releasing AOP

## What ships

| Artifact | For | Built on |
| --- | --- | --- |
| `aop-linux-x64`, `aop-linux-arm64`, `aop-darwin-x64`, `aop-darwin-arm64` | The host: the `aop` server and CLI in one binary | Linux runner (Bun cross-compiles all four) |
| `runtime-assets.tar.gz` | The dashboard the host serves, unpacked next to the binary | Linux runner |
| `aop-macos-arm64.dmg`, `aop-macos-x64.dmg` | The macOS desktop app | macOS runner |
| `aop-windows-x64-setup.exe` | The Windows desktop app | Windows runner |
| `checksums.sha256` | SHA-256 of every file above, checked by `install.sh` | Linux runner |

The host runs on macOS and Linux only. Windows gets the desktop app and nothing else: there is no Windows host, CLI, server binary or PowerShell installer. The Windows app is a client of a host: it bundles the dashboard, pairs over `https://` and starts no server. The macOS app is the same client and can also run the host on that Mac from its bundled `aop` binary.

The host has no installer app. One terminal command installs it and starts it:

```bash
curl -fsSL https://getaop.com/install.sh | sh
```

## Cut a release

From a clean checkout of `main`:

```bash
bun run release patch          # or minor, major, or an explicit X.Y.Z
bun run release patch --dry-run
```

This bumps the version in the root `package.json` (the one place the AOP version lives), runs `bun check`, commits `chore: release vX.Y.Z`, tags `vX.Y.Z` and pushes both. Pushing the tag starts the `Release` workflow. Use `--no-push` to commit and tag locally and push yourself, and `--skip-check` to skip `bun check`.

The workflow (`.github/workflows/release.yml`) runs these jobs:

1. `build` compiles the four host binaries and `runtime-assets.tar.gz` (`bun run build:release`).
2. `package-macos` builds both DMGs on `macos-latest`.
3. `package-windows` builds the NSIS installer on `windows-latest`. It needs no host binary.
4. `assemble` downloads everything, fails if any file is missing or if an `aop-windows-x64.exe` appears, and writes `checksums.sha256`.
5. `release` (tag pushes, and manual runs with `publish` on) creates the GitHub Release and runs `scripts/release/deploy-r2.sh`.

On a pull request that touches the release files, jobs 1 to 4 run and stop. Nothing is published, and the assembled files are kept for a day as the `release-all` workflow artifact, so a change to the packaging is checked before it merges.

To rebuild and publish a release by hand, run the workflow from the Actions tab (`workflow_dispatch`) with `publish` on, optionally with a `release_ref`.

### Build installers without releasing

To get the installers for any branch, tag or commit without publishing anything, run the workflow from the Actions tab (`workflow_dispatch`) with `publish` left off (its default) and `release_ref` set to the ref. Or from a terminal:

```bash
gh workflow run release.yml --ref main -f publish=false
```

This runs jobs 1 to 4 and stops, like a pull request: no GitHub Release, no R2 upload, no signing or notarization, and no Apple or Cloudflare secret is read. When it finishes, open the run and download the `release-all` artifact, which holds every file including `aop-windows-x64-setup.exe` and `checksums.sha256`. The artifact is kept for one day. The version in the file names is the one in the root `package.json` of the ref.

### What `deploy-r2.sh` publishes

1. The versioned files under `getaop.com/vX.Y.Z/`.
2. A probe of each one through the public address, retrying while the CDN catches up.
3. `getaop.com/latest/aop-macos-arm64.dmg`, `latest/aop-macos-x64.dmg` and `latest/aop-windows-x64-setup.exe`, so the desktop downloads have a link that never changes.
4. `getaop.com/install.sh`, last. The script is copied with its `DEFAULT_VERSION` line set to this release, so the published script installs exactly this release. There is no separate "latest version" file to keep in step. Publishing it last means nobody is pointed at a release whose files are not yet reachable.

The script needs these repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `AOP_RELEASES_R2_BUCKET`.

### Release from your own machine

```bash
bun run release:local --version X.Y.Z --dry-run   # print the steps first
bun run release:local --version X.Y.Z
```

This builds the host binaries, packages the installer for the machine it runs on (DMGs on a Mac, the NSIS installer on Windows), writes the checksums, creates or updates the GitHub Release and deploys to R2. `--skip-build`, `--skip-macos`, `--skip-windows`, `--skip-github-release` and `--skip-r2` leave a step out. A Windows machine passes `--skip-r2`, because R2 is deployed from the Mac. Packaging on a Mac with `AOP_MACOS_SIGN_IDENTITY` set in the environment signs the build with that identity, and with `AOP_MACOS_NOTARIZE` set it also submits the DMG to Apple, so unset both for an unsigned local build.

Build one host binary or one desktop app without releasing:

```bash
bun run build:release -- --target darwin-arm64     # dist/release/aop-darwin-arm64 + runtime-assets.tar.gz
bun run package:macos-dmg -- --arch arm64          # dist/release/aop-macos-arm64.dmg (needs the line above)
bun run package:windows                            # on Windows: dist/release/aop-windows-x64-setup.exe
```

## Signing is off

Every build is unsigned, on purpose, until signing is decided. The Apple and Windows secrets may already exist in the repository, but the workflow does not read them unless two things are true: the run is a tag push or a manual run (never a pull request), and the repository variable `AOP_SIGN_RELEASES` is `true`. Nothing in the workflow needs to change to sign: set the variable and make sure the secrets below exist.

An unsigned macOS build is still ad-hoc signed (`mac.identity: "-"` in `scripts/desktop/electron-builder-config.ts`). Without any signature Apple silicon kills the app at launch, because changing the Electron fuses invalidates the signature the framework shipped with.

### macOS (Developer ID and notarization)

| Secret | Purpose |
| --- | --- |
| `AOP_MACOS_CERTIFICATE_P12_BASE64` | Base64 of the Developer ID Application `.p12` certificate |
| `AOP_MACOS_CERTIFICATE_PASSWORD` | Password of that `.p12` |
| `AOP_MACOS_SIGN_IDENTITY` | Codesign identity, such as `Developer ID Application: Example Inc (TEAMID)` |
| `AOP_MACOS_NOTARIZE` | `1` to submit the DMGs to Apple notarization |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Notarization credentials |
| `AOP_MACOS_KEYCHAIN_PASSWORD` | Optional password for the temporary CI keychain |

The places to look are the `TODO(signing)` and `TODO(notarization)` comments in `release.yml` and `scripts/release/macos-dmg.ts`, which reads these variables, signs the host binary the Mac app carries, and hands the rest to Electron Builder to sign the app.

### Windows (Authenticode)

Set `AOP_WINDOWS_PFX_BASE64` (base64 of the code-signing `.pfx`) and `AOP_WINDOWS_PFX_PASSWORD`. `scripts/release/windows-installer.ts` passes them to Electron Builder, which signs the app and the installer. The place to look is the `TODO(signing)` comment in the `package-windows` job.

### Until then: the warnings people see

Tell anyone you send a build to about these.

- **macOS Gatekeeper.** Opening `AOP.app` for the first time says it "cannot be opened because it is from an unidentified developer" or "cannot be verified". Open it with right-click, then **Open**, or allow it in System Settings, **Privacy & Security**, **Open Anyway**. If macOS says the app "is damaged", run `xattr -dr com.apple.quarantine /Applications/AOP.app` in a terminal, which clears the download flag, and open it again.
- **Windows SmartScreen.** Running `aop-windows-x64-setup.exe` shows "Windows protected your PC". Choose **More info**, then **Run anyway**. The warning fades as the installer gains reputation, and goes away with a signed build.
- **The host needs neither.** `install.sh` downloads with `curl`, which does not set the quarantine flag, and it signs the `aop` binary ad hoc on macOS so launchd can restart it.

## Troubleshooting

- **Tag already exists.** Delete the local tag or pick a new version.
- **A pull request shows the release jobs red.** Open the failing job: `assemble` names the missing artifact. The `ci` job is the merge gate; the release jobs are there to catch packaging breakage early.
- **R2 step fails on missing secrets.** Add the three Cloudflare secrets and run the workflow again from the Actions tab.
- **`install.sh` says it is "not tied to a release".** You ran a copy from a checkout. Pass `--version X.Y.Z`, or use the copy published at `getaop.com/install.sh`.
