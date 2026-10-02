# Releasing AOP

## What ships

| Artifact | For | Built on |
| --- | --- | --- |
| `aop-linux-x64`, `aop-linux-arm64`, `aop-darwin-x64`, `aop-darwin-arm64` | The host: the `aop` server and CLI in one binary | Linux runner (Bun cross-compiles all four) |
| `runtime-assets.tar.gz` | The dashboard the host serves, unpacked next to the binary | Linux runner |
| `aop-macos-arm64.dmg`, `aop-macos-x64.dmg` | The macOS desktop app | macOS runner |
| `aop-windows-x64-setup.exe` | The Windows desktop app | Windows runner |
| `latest.yml`, `aop-windows-x64-setup.exe.blockmap` | What the installed Windows app updates itself from (electron-updater, through getaop.com) | Windows runner |
| `aop-macos-arm64.zip`, `aop-macos-x64.zip`, `latest-mac.yml` | What a signed, installed macOS app updates itself from (electron-updater and Squirrel.Mac, through getaop.com) | macOS runner |
| `checksums.sha256` | SHA-256 of the host binaries, the assets archive and the installers, checked by `install.sh`. The updater files are not in it: `latest.yml` and `latest-mac.yml` carry the sha512 of what they name | Linux runner |

The host runs on macOS and Linux only. Windows gets the desktop app and nothing else: there is no Windows host, CLI, server binary or PowerShell installer. The Windows app is a client of a host: it bundles the dashboard, pairs over `https://` and starts no server. The macOS app is the same client and can also run the host on that Mac from its bundled `aop` binary.

The host has no installer app. One terminal command installs it and starts it:

```bash
curl -fsSL https://getaop.com/install.sh | sh
```

AOP Nightly, built from `main` after every merge and published to `getaop.com/nightly/` without a release, has its own workflow, environment and feed: see [NIGHTLY.md](./NIGHTLY.md). Nothing in this document changes for it.

## Cut a release

From a clean checkout of `main`:

```bash
bun run release patch          # or minor, major, or an explicit X.Y.Z
bun run release patch --dry-run
```

This bumps the version in the root `package.json` (the one place the AOP version lives), runs `bun check`, commits `chore: release vX.Y.Z`, tags `vX.Y.Z` and pushes both. Pushing the tag starts the `Release` workflow. Use `--no-push` to commit and tag locally and push yourself, and `--skip-check` to skip `bun check`.

The workflow (`.github/workflows/release.yml`) runs these jobs:

1. `build` compiles the four host binaries and `runtime-assets.tar.gz` (`bun run build:release`).
2. `package-macos` builds both DMGs on `macos-latest`, with a zip of the app per architecture and the `latest-mac.yml` naming both (`scripts/release/macos-updater.ts`).
3. `package-windows` builds the NSIS installer on `windows-latest`, with `latest.yml` and the blockmap electron-builder writes beside it. It needs no host binary.
4. `assemble` downloads everything, fails if any file is missing or if an `aop-windows-x64.exe` appears, prints `latest.yml` and fails unless it names this run's version and installer file and carries the installer's sha512 (this is where the Windows updater config is checked in CI), does the same for `latest-mac.yml` and both zips, and writes `checksums.sha256`.
5. `release` (tag pushes, and manual runs with `publish` on) writes the release notes (`scripts/release/release-notes.ts`, generated against the newest older release by version, because release tags are never ancestors of each other here), creates the GitHub Release with them and runs `scripts/release/deploy-r2.sh`.

On a pull request that touches the release files, jobs 1 to 4 run and stop. Nothing is published, and the assembled files are kept for a day as the `release-all` workflow artifact, so a change to the packaging is checked before it merges.

To rebuild and publish a release by hand, run the workflow from the Actions tab (`workflow_dispatch`) from its `vX.Y.Z` tag (the "Use workflow from" picker) with `publish` on. A publishing run started from a branch is refused, because the `release` environment accepts only `v*` tags.

### The `release` environment

Every secret the workflow reads lives in the `release` environment (Settings → Environments → `release`), not in the repository's secrets. The environment accepts deployments only from `v*` tags, and each run waits there until the maintainer approves it (Actions → the run → **Review deployments**). Self-approval is allowed, because the project has one maintainer.

- The `release` job always enters the environment, so a tag push builds everything and then waits for approval before publishing.
- `package-macos` and `package-windows` enter it only when they sign (a publishing run with `AOP_SIGN_RELEASES` on), so a signed release asks for approval twice: once for packaging, once for publishing.
- Pull requests and build-only dispatches enter no environment and read no secret.
- `AOP_SIGN_RELEASES` is a repository variable (Settings → Secrets and variables → Actions → Variables), not an environment variable: the packaging jobs read it to decide whether to enter the environment at all.

The workflow pins every action to a commit SHA, with the version in a comment; Dependabot proposes the updates. `deploy-r2.sh` runs one exact wrangler version (`WRANGLER`) for the same reason.

### Build installers without releasing

To get the installers for any branch, tag or commit without publishing anything, run the workflow from the Actions tab (`workflow_dispatch`) with `publish` left off (its default) and `release_ref` set to the ref. Or from a terminal:

```bash
gh workflow run release.yml --ref main -f publish=false
```

This runs jobs 1 to 4 and stops, like a pull request: no GitHub Release, no R2 upload, no signing or notarization, and no Apple or Cloudflare secret is read. When it finishes, open the run and download the `release-all` artifact, which holds every file including `aop-windows-x64-setup.exe` and `checksums.sha256`. The artifact is kept for one day. The version in the file names is the one in the root `package.json` of the ref.

### What `deploy-r2.sh` publishes

1. The versioned files under `getaop.com/vX.Y.Z/` (with the Windows blockmap, which electron-updater compares).
2. A probe of each one through the public address, retrying while the CDN catches up.
3. `getaop.com/latest/aop-macos-arm64.dmg`, `latest/aop-macos-x64.dmg` and `latest/aop-windows-x64-setup.exe`, so the desktop downloads have a link that never changes.
4. The release feed ([below](#the-release-feed)): `releases/vX.Y.Z.json` and `releases/vX.Y.Z.md`, probed like the files, then the pointers `latest/latest.yml`, `repos/get-aop/aop-mono/releases/latest` and `releases/latest.json`.
5. The retired `latest/version` file (AOP 0.9 read it; nothing has written it since 0.9.51) is deleted.
6. `getaop.com/install.sh`, last. The script is copied with its `DEFAULT_VERSION` line set to this release, so the published script installs exactly this release. There is no separate "latest version" file to keep in step. Publishing it last means nobody is pointed at a release whose files are not yet reachable.

The script needs these `release` environment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `AOP_RELEASES_R2_BUCKET`.

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

## The release feed

The repository is private, so an install cannot read its GitHub Releases. Every updater reads the feed `deploy-r2.sh` publishes on getaop.com instead, written by `scripts/release/release-feed.ts` from `dist/release` and `checksums.sha256`:

| Address | Cache | Read by |
| --- | --- | --- |
| `https://getaop.com/releases/latest.json` | 5 minutes | the host (`aop update`, the dashboard's notice) and the macOS app |
| `https://getaop.com/releases/vX.Y.Z.json` | 5 minutes | the same document for one release, kept after newer ones ship |
| `https://getaop.com/releases/vX.Y.Z.md` | 5 minutes | the release notes as text: the "Release notes" links open it |
| `https://getaop.com/latest/latest.yml` | 5 minutes | the Windows app (electron-updater, generic provider); it names the installer and blockmap under `vX.Y.Z/` |
| `https://getaop.com/latest/latest-mac.yml` | 5 minutes | a signed macOS app (electron-updater, generic provider); it names both zips under `vX.Y.Z/` |
| `https://getaop.com/repos/get-aop/aop-mono/releases/latest` | 5 minutes | the feed in GitHub's release shape, for AOP 0.10.0 to 0.10.4 pointed here with `AOP_GITHUB_API_URL=https://getaop.com` ([Host](./HOST.md#updating-from-0100-to-0104)) |

`releases/latest.json` (schema 1):

```json
{
  "schemaVersion": 1,
  "version": "0.10.5",
  "publishedAt": "2026-10-02T14:03:11Z",
  "notes": "## What's Changed\n* ...",
  "notesUrl": "https://getaop.com/releases/v0.10.5.md",
  "files": [
    {
      "name": "aop-darwin-arm64",
      "kind": "host",
      "os": "darwin",
      "arch": "arm64",
      "url": "https://getaop.com/v0.10.5/aop-darwin-arm64",
      "sha256": "874b7c09…",
      "size": 64800098
    }
  ]
}
```

`files` lists every file in `checksums.sha256` and that file itself. `kind` is `host` (with `os` `darwin` or `linux` and `arch` `x64` or `arm64`), `desktop` (`os` `macos` or `windows`), `runtime-assets` or `checksums`; a reader ignores kinds and fields it does not know, so adding them keeps schema 1. A change an older reader would misread goes to a new path instead. The script checks every file against `checksums.sha256` before it writes a digest, so the feed never promises a digest the published file does not have. The schema and its parser are `packages/common/src/release-feed.ts`.

The notes come from `dist/release-notes.md` (the workflow and `release:local` write it); without it the feed carries empty notes and says so.

## Host updates

An installed host reads `releases/latest.json` and offers the release when its `version` is newer than the host's build (`0.10.0+<commit>`; the `+commit` part is ignored). It downloads `aop-<os>-<arch>` for its platform and `runtime-assets.tar.gz` from the URLs in the feed and checks each against the feed's sha256. A release that lacks one is refused with a message naming it, and nothing on the host changes. With a GitHub token in its environment the host falls back to the GitHub Release when the feed cannot be read. How the host behaves, the restart, and how to turn the check off are in [Updating the host](./HOST.md#updating-the-host). The first release with the updater is `v0.10.0`; hosts older than it have no `aop update`, so they update once by running `install.sh` again.

Test the whole path against a fake feed instead of a real release. `fake-feed.ts` builds the feed with the same code as the release and serves the files beside it:

```bash
bun scripts/release/fake-feed.ts --dir <folder with aop-darwin-arm64 and runtime-assets.tar.gz> --version 0.10.0 --port 25511
AOP_RELEASE_FEED_URL=http://127.0.0.1:25511 aop update --check
```

The unit tests of `apps/local-server/src/update/` run against an in-process feed the same way and never reach getaop.com or GitHub. `.claude/skills/verify/features/updates.md` has the full recipe with two stamped binaries.

## Desktop app updates

The apps read the feed on getaop.com, like the host.

| App | What happens |
| --- | --- |
| Windows | Real auto update with electron-updater. The app looks at startup and every six hours, downloads the new installer in the background (only the changed blocks, through the blockmap), and installs it when the app restarts. The window menu gains "Restart to update (x.y.z)" once the download is ready. |
| macOS, Developer ID signed | The same auto update as Windows. electron-updater reads `latest-mac.yml`, downloads the zip for this Mac's architecture (arm64 on Apple silicon), checks its sha512, and Squirrel.Mac swaps the app when it restarts. "Restart to update (x.y.z)" appears in the menu once the download is ready. |
| macOS, ad-hoc signed | A notice only: Squirrel.Mac installs an update only over a signed app. The app looks at the latest release at startup and every six hours and, when it is newer, adds "Update available (x.y.z)" to the window title and a menu with a link to the DMG for this Mac's architecture. The person downloads and replaces the app by hand. |

The macOS app decides at startup, from its own signature: it runs `codesign -dv` on its bundle and updates itself only when a `Developer ID Application` authority signed it (`apps/desktop/electron/updates/mac-signature.ts`). A release built with signing on is such an app, so nothing in the code is switched: the first signed release is installed from its DMG once, and every release after it arrives on its own. Squirrel.Mac also refuses an update signed by another team, or not signed at all, so once releases are signed they must stay signed with the same team: an unsigned release would leave signed apps failing their update quietly (the failure is only in `desktop.log`).

Both apps also say when the host runs another release than the app: a line on the status screen, the Host menu and a few words in the window title ("host 0.10.0 is newer" means update the app, "host 0.9.0 is older" means run `aop update` on the host). It is only a notice; the API version handshake decides whether they can talk.

How the pieces fit:

- `scripts/desktop/electron-builder-config.ts` has a generic `publish` entry for `https://getaop.com/latest/`. With `--publish never` (what the workflow passes) electron-builder uploads nothing but still writes `latest.yml` and the blockmap for the Windows installer, and `app-update.yml` into the app's resources. The app also sets that feed itself (`electron-updater-port.ts`), so a Windows app built when the feed was GitHub finds it too. The same entry makes each macOS build write a `latest-mac.yml` naming only its own architecture; `scripts/release/macos-dmg.ts` builds both architectures, copies each DMG and zip into `dist/release`, and writes the `latest-mac.yml` that ships, naming both zips with their sha512 and size (`scripts/release/macos-updater.ts`).
- The workflow uploads the zips and `latest-mac.yml` from `package-macos`, checks them in `assemble` (`macos-updater.ts check`), and attaches them to the GitHub Release; `deploy-r2.sh` puts the zips under `vX.Y.Z/` and a copy of `latest-mac.yml` that names them there under `latest/`.
- `scripts/release/windows-installer.ts` copies the installer, `latest.yml` and `aop-windows-x64-setup.exe.blockmap` into `dist/release`. The workflow uploads them from `package-windows`, requires them in `assemble`, and attaches them to the GitHub Release; `deploy-r2.sh` puts the installer and blockmap under `vX.Y.Z/` and a copy of `latest.yml` that names them there under `latest/`. `scripts/release/updater-wiring.test.ts` keeps those lists the same.
- The installer is per-user, so an update needs no elevation. An unsigned installer updates too: electron-updater checks the sha512 in `latest.yml`; it checks a publisher name only if one is configured, and none is.

### Turn on macOS auto update

Set the repository variable `AOP_SIGN_RELEASES` to `true` (with the secrets in [Signing is off](#signing-is-off)) and cut a release. Its app is signed and notarized, and it updates itself from then on. An app installed from an earlier, ad-hoc signed DMG keeps showing the notice until that signed DMG is installed by hand once.

### Settings and testing

- `AOP_DESKTOP_DISABLE_UPDATES=1` in the app's environment turns the check off. A development run (not packaged) never auto updates, and on macOS shows the notice.
- `AOP_RELEASE_FEED_URL` points the apps (and the host) at another feed, such as `http://127.0.0.1:<port>`. Run `bun scripts/release/fake-feed.ts --dir <folder of assets> --version 99.0.0 --port <port>` to serve one. The app opens a download link from such a feed only when it is https, or plain http on this computer while `AOP_RELEASE_FEED_URL` is set.
- Windows cannot be run from a Mac. Its updater configuration is checked in the `assemble` job's "Check the Windows updater config" step, whose log prints `latest.yml`. "Check the macOS updater config" does the same for `latest-mac.yml`.

## Signing is off

Every build is unsigned, on purpose, until signing is decided. The Apple and Windows secrets may already exist in the `release` environment, but the workflow does not read them unless two things are true: the run is a tag push or a manual run (never a pull request), and the repository variable `AOP_SIGN_RELEASES` is `true`. Nothing in the workflow needs to change to sign: set the variable and make sure the secrets below exist.

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
- **R2 step fails on missing secrets.** Add the three Cloudflare secrets to the `release` environment and run the workflow again from the Actions tab, from the tag.
- **A release run waits.** It is waiting for approval in the `release` environment: open the run and choose **Review deployments**.
- **`install.sh` says it is "not tied to a release".** You ran a copy from a checkout. Pass `--version X.Y.Z`, or use the copy published at `getaop.com/install.sh`.
