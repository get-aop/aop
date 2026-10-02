# AOP Nightly

AOP Nightly is a second AOP, built from `main` after every merge, that runs beside the stable AOP on the same machine and keeps itself current. Use it to try a feature as soon as it merges, without waiting for a release.

```bash
curl -fsSL https://getaop.com/nightly/install.sh | sh     # the host: aop-nightly on port 25650
```

The app is `AOP Nightly.app`, from `https://getaop.com/nightly/latest/aop-macos-arm64.dmg` (or `aop-macos-x64.dmg`).

## How T3 Code does it, and what we took

T3 Code (`pingdotgg/t3code`) has a nightly train in the same `release.yml` as stable:

- A schedule every 30 minutes builds `main` when it moved since the last nightly and at least six hours passed. Runs are serialized in one concurrency group.
- Version `X.Y.(Z+1)-nightly.YYYYMMDD.<run>`: the next patch, so a nightly sorts above the stable it follows and below the stable it previews.
- Each nightly is a GitHub pre-release with its own electron-updater manifests.
- The desktop build changes the product name ("T3 Code (Nightly)") and the icon. The app id and data folder stay the same: nightly is a channel you switch to in the same app, not a second app.

We took the versioning, the skip-when-unchanged rule, the serialized runs, the renamed and re-iconed app, and a feed of its own. We did not take the shared app id and data folder: AOP Nightly runs at the same time as AOP, so it is a second app with its own identity. We also don't use GitHub pre-releases (see [Publishing](#publishing)).

## Identity: one channel table, set at build time

Everything that names an install comes from `CHANNELS` in `packages/common/src/channel.ts`. A build sets `AOP_BUILD_CHANNEL=nightly` in its environment, and every bundler bakes it in with `define` (the host build `scripts/installer/build.ts`, the dashboard `apps/dashboard/build.ts`, the desktop screens `apps/desktop/vite.config.ts`, the Electron main process `scripts/desktop/build-electron.ts`, and `scripts/desktop/electron-builder-config.ts`). `buildChannel()` reads it. A build without it is stable, so the stable release path is unchanged.

| | Stable | Nightly |
| --- | --- | --- |
| Data folder (DB, logs, worktrees, `mcp-secret`, `server.pid`) | `~/.aop` | `~/.aop-nightly` |
| Host port, dashboard port | 25150, 25160 | 25650, 25660 |
| Host binary | `aop` in `~/.local/bin` (or `/usr/local/bin`) | `aop-nightly` in `~/.aop-nightly/bin`, run by name through a launcher in `~/.local/bin` |
| launchd label, systemd unit | `com.aop.local-server`, `aop-local-server` | `com.aop.local-server.nightly`, `aop-nightly-local-server` |
| Desktop app | `AOP.app`, `com.getaop.aop` | `AOP Nightly.app`, `com.getaop.aop.nightly`, icon with a "NIGHTLY" band (`apps/desktop/build/nightly/`) |
| App data (Electron `userData`, keychain item, single-instance lock) | `~/Library/Application Support/AOP` | `~/Library/Application Support/AOP Nightly` (Electron derives them from the product name) |
| Feed origin | `https://getaop.com` | `https://getaop.com/nightly` |
| `/api/health` `channel` | `stable` | `nightly` |

Ports 25650/25660 are free: 25150/25160 belong to stable and `bun dev`, 25170 to the desktop dev server, 25250/25260 to `bun run local:aop`, 25350/25360 to the isolated desktop and 25400 to 25499 to the verify skill.

`AOP_HOME`, `AOP_LOCAL_SERVER_PORT` and the other variables still override the defaults, as they do for stable. The `app://` scheme is registered only inside each app, so there's no deep link to share. The dashboard shows "Nightly" beside the brand.

Shared on purpose: `~/.claude` (the same Claude Code login and skills), `gh` auth, and your repository checkouts.

## Projects and data

Nightly starts with its own empty database. To try it on real work, register the same checkout in it. AOP registers a repository by its path and makes thread worktrees under its own data folder, so stable and nightly can both use `~/workspace/aop-mono` with their own worktrees and branches (`aop/<slug>-<id>` names don't collide). Nothing is copied, and nothing a nightly does reaches stable's database.

Never point nightly at stable's database: a nightly migration would leave a schema stable refuses to open ("newer than this build supports").

Both hosts run `git fetch` and `git worktree prune` in the same `.git`. Prune only drops entries whose folder is gone, so neither removes the other's worktrees. Two fetches at the same moment can fail on a ref lock, and that is retried like any other fetch failure.

## Builds and versions

`.github/workflows/nightly.yml` runs after every push to `main` whose `AOP CI` run succeeds (`workflow_run`), and on a manual run from `main`:

- Only a `workflow_run` of a push to `main` in this repository passes the `resolve` job. Pull request runs of `ci`, forks included, fire `workflow_run` too, and they stop there. The commit must be on `origin/main`.
- Publishing also needs the repository variable `AOP_NIGHTLY_ENABLED=true`.
- One concurrency group, never cancelled: a burst of merges leaves one pending run, which builds the newest `main`.
- A commit the feed already carries is skipped.
- A pull request that changes the nightly files, or a manual run with "publish" off, builds everything unsigned, checks it and runs `deploy-nightly.sh` as a dry run (`AOP_NIGHTLY_DRY_RUN=1`). Nothing is published and no secret is read.

The version is `<next patch>-nightly.<YYYYMMDD>.<run number>` (`scripts/release/nightly-version.ts`), for example `0.10.7-nightly.20261002.14`. The host adds the commit as build metadata: `aop-nightly --version` and `/api/health` say `0.10.7-nightly.20261002.14+c213357`. The feed carries the full commit. Semver orders builds by date, then run, and every nightly sorts above `0.10.6` and below `0.10.7`. `packages/common/src/version.ts` keeps the nightly part when it compares versions. A stable install still accepts only `x.y.z` releases, which guards on top of the separate feed. A nightly install accepts only nightlies.

## Publishing

R2 only, no GitHub release. A nightly tag would match `v*`, and the `release tags` ruleset lets only admins create those. Hundreds of pre-releases would also bury the real ones, and every updater reads R2 anyway.

`scripts/release/deploy-nightly.sh` writes to its own bucket over R2's S3 API (the `aws` CLI on GitHub's runners), with a key scoped to that bucket. Every key is under `nightly/`, served at `getaop.com/nightly/`:

| Path | What |
| --- | --- |
| `nightly/v<version>/…` | The build: four host binaries, `runtime-assets.tar.gz`, both DMGs and update zips, `checksums.sha256`. Same file names as a release |
| `nightly/releases/v<version>.json`, `.md` | The feed document (schema 1 with `commit` and `channel: nightly`) and the notes: the commits since the previous nightly |
| `nightly/releases/latest.json` | Pointer: what nightly hosts and the nightly app's notice read |
| `nightly/latest/latest-mac.yml` | Pointer: what a signed AOP Nightly.app updates itself from (absolute URLs into `nightly/v<version>/`) |
| `nightly/latest/aop-macos-{arm64,x64}.dmg` | Download links that never change |
| `nightly/releases/index.json` | The published builds, newest first (`scripts/release/nightly-index.ts`) |
| `nightly/install.sh` | Stamped with the version and `CHANNEL="nightly"`, uploaded last |

The order is the same as `deploy-r2.sh`: versioned files, a probe of each through the public address, the download aliases, the versioned feed documents (probed), the pointers, the index, `install.sh`. Then it deletes the files of every build past the newest 10 (`AOP_NIGHTLY_KEEP`). A build is about 700 MB, so 10 builds take about 7 GB.

There's no Windows nightly, because nightly is for the maintainer's Mac. Linux host binaries cost nothing extra: Bun cross-compiles them on the same runner.

getaop.com is a Worker in `get-aop/aop-web`. It must route `/nightly/*` to the nightly bucket, or the deploy fails at its first probe.

## Signing and the `nightly` environment

Stable's `release` environment accepts only `v*` tags and waits for the owner's approval, so it can't run on every merge. Nightly publishes from a separate `nightly` environment that accepts deployments from `main` only, with no required reviewer. It holds the Apple signing secrets (same Developer ID; a Developer ID app needs no registered bundle id, so `com.getaop.aop.nightly` needs no Apple setup) and a key scoped to the nightly bucket. Stable's account-wide Cloudflare token stays in `release`: with it, a nightly run could overwrite stable's `install.sh`. With the bucket key, publishing stable still needs the owner's approval.

The trade-off: **anything merged to `main` is built, signed with the Developer ID, notarized and published to the nightly feed without anyone approving it.** Today only the owner merges, and merges wait for `ci`. A malicious change that got merged would ship a signed app to nightly users. The stable gate doesn't review code either (the owner approves a tag, not a diff), so the new exposure is "merged code is signed within the hour" instead of "at the next release". Pull request runs never enter the environment and read no secret. `scripts/release/nightly-wiring.test.ts` holds these rules.

## Updates

- **Host.** `aop-nightly` reads `getaop.com/nightly/releases/latest.json`. It downloads its platform's binary and `runtime-assets.tar.gz`, checks sha256, signs ad hoc, runs `--version`, swaps with `.previous` kept, restarts through its own launchd agent or systemd unit, and rolls back unless `/api/health` reports the new version within 60 seconds. This is the same code as stable (`apps/local-server/src/update/`), with the channel as a parameter.
- **On its own.** Stable looks once a day, and the owner clicks "Update now". Nightly looks every hour and installs a newer build itself once **no agent turn is running**. While turns run, it looks again every 10 minutes, so it never restarts mid-turn by choice. After a build fails to start (and is rolled back), it waits 6 hours before trying on its own again. Turn this off with the setting `update_auto_apply` (Settings › Updates, "Install nightly builds automatically", nightly only). "Update now" still works.
- **Mid-turn safety.** If a restart lands mid-turn anyway (a crash, a manual update), detached runs survive and the new host recovers them. The MCP secret persists in `~/.aop-nightly/mcp-secret` (#44), so a thread's AOP tools keep working across the restart.
- **Desktop.** AOP Nightly.app reads `nightly/latest/latest-mac.yml` with `allowPrerelease` on, and Squirrel.Mac swaps it when it restarts. The signature gate is the same as stable: it updates itself when Developer ID signed, and shows a notice otherwise.

## Install

`install.sh` carries a `CHANNEL` line, which `deploy-nightly.sh` stamps `nightly`. That copy:

- puts `aop-nightly` and its dashboard in `~/.aop-nightly/bin`, and a launcher `~/.local/bin/aop-nightly` that runs it (a launcher, not a symlink, so the host always runs from the path its service and updater name);
- writes `~/Library/LaunchAgents/com.aop.local-server.nightly.plist` (or the `aop-nightly-local-server` systemd unit) on port 25650, with logs in `~/.aop-nightly/logs`, and starts it;
- frees only port 25650, and never touches stable's service, `~/.local/bin/aop` or `~/.local/bin/dashboard`;
- reads only `AOP_NIGHTLY_RELEASES_URL`, `AOP_NIGHTLY_LOCAL_SERVER_PORT` and `AOP_NIGHTLY_DASHBOARD_PORT`, never stable's variables. A shell inside a stable AOP thread carries `AOP_LOCAL_SERVER_PORT=25150`, and honouring it would stop the stable host.

The app adopts the nightly host on 25650, and starts the one it bundles when none is running. On one Mac at once that's two launchd agents, two ports, two data folders, two apps with their own bundle ids, keychain items and app-data folders, and two commands (`aop`, `aop-nightly`). The dashboards are `http://aop.localhost:25150` and `http://aop.localhost:25650`.

## Using nightly to develop AOP

- **Nightly restarts its own host while a thread works on AOP.** It updates only when no turn is running, and a turn interrupted anyway survives (detached runs, #44). A thread that merges its own PR starts the build that will restart its host about 30 minutes later, usually after it's done.
- **A broken `main` breaks the tool you'd fix it with.** Health-check rollback catches only a host that doesn't start. For one that starts but misbehaves, stable AOP is installed and untouched: fix `main` from stable. To go back, install an older nightly (the last 10 stay published): `curl -fsSL https://getaop.com/nightly/install.sh | sh -s -- --version <version>`. To stay on the build you have, turn `update_auto_apply` off.
- **An older nightly can't open a database a newer one migrated.** The migration ledger refuses a newer schema. Going back past a migration means fixing forward, or moving `~/.aop-nightly/projects.sqlite` aside to start empty. Nightly's data is a scratch copy by design.
- **Inherited environment.** A nightly thread inherits `AOP_LOCAL_SERVER_PORT=25650` and the other `AOP_*` variables, like a stable thread does. Running AOP's tests from a nightly thread needs the same `unset AOP_*` (see the testing notes).

## Maintainer setup (once)

1. **Cloudflare.** Create the R2 bucket `aop-nightly`. Create an R2 API token with **Object Read & Write** on that bucket only, and note its access key id, secret, and the S3 endpoint `https://<account id>.r2.cloudflarestorage.com`.
2. **aop-web.** Merge the change that binds the bucket and routes `/nightly/*` to it.
3. **GitHub, Settings › Environments › New environment `nightly`.**
   - Deployment branches and tags: **Selected branches and tags**, add the branch rule `main`. No required reviewers, no wait timer.
   - Environment secrets. Secrets can't be copied out of `release`, so re-enter these values: `AOP_MACOS_CERTIFICATE_P12_BASE64`, `AOP_MACOS_CERTIFICATE_PASSWORD`, `AOP_MACOS_SIGN_IDENTITY`, `AOP_MACOS_NOTARIZE`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (and `AOP_MACOS_KEYCHAIN_PASSWORD` if `release` has it). Add the new `AOP_NIGHTLY_R2_ACCESS_KEY_ID`, `AOP_NIGHTLY_R2_SECRET_ACCESS_KEY`, `AOP_NIGHTLY_R2_ENDPOINT` and `AOP_NIGHTLY_R2_BUCKET` (`aop-nightly`).
4. **GitHub, Settings › Secrets and variables › Actions › Variables.** Add the repository variable `AOP_NIGHTLY_ENABLED` = `true`. Until it is set, merges build no nightly.
5. Run **Nightly** from the Actions tab on `main` with "publish" on, or merge something. Then install the host and the app once by hand; from then on both update themselves.
