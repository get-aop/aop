# AOP Nightly

AOP Nightly is a second AOP, built from `main` after every merge, that runs beside the stable AOP on the same machine and keeps itself current. Use it to try a feature as soon as it merges, without waiting for a release.

Status: design. Decisions marked ★ wait for the maintainer's confirmation.

## How T3 Code does it, and what we take

T3 Code (`pingdotgg/t3code`) has a nightly train in the same `release.yml` as stable:

- A schedule every 30 minutes builds `main` when it moved since the last nightly and at least six hours passed. Runs are serialized in one concurrency group.
- Version `X.Y.(Z+1)-nightly.YYYYMMDD.<run>`: the next patch, so a nightly sorts above the stable it follows and below the stable it previews. The commit sits in the release name.
- Each nightly is a GitHub pre-release, never marked latest, with its own electron-updater manifests. The release notes compare against the previous nightly.
- The desktop build changes the product name ("T3 Code (Nightly)") and the icon. The app id and data folder stay the same: nightly is a channel you switch to in the same app, not a second app.

We take the versioning, the skip-when-unchanged rule, the serialized runs, the renamed and re-iconed app, and a feed of its own. We do not take the shared app id and data folder: AOP Nightly must run at the same time as AOP, so it is a second app with its own identity. We also don't use GitHub pre-releases (see [Publishing](#4-publishing)).

## 1. Identity: one channel config, set at build time

Every place stable hard-codes its identity reads it from one table in `@aop/common` (`channel.ts`) instead. The build picks the row: `scripts/installer/build.ts` and the desktop build pass `--channel nightly`, which Bun bakes in with `define` (as it does `BUILD_VERSION`). A build without it is stable, so the stable release path does not change.

| | Stable | Nightly |
| --- | --- | --- |
| Data folder (DB, logs, worktrees, `mcp-secret`, `server.pid`) | `~/.aop` | `~/.aop-nightly` |
| Host port, dashboard port | 25150, 25160 | 25650, 25660 |
| Host binary and install folder | `aop` in `~/.local/bin` (or `/usr/local/bin`) | `aop-nightly` in `~/.aop-nightly/bin`, linked from `~/.local/bin/aop-nightly` |
| launchd label, systemd unit | `com.aop.local-server`, `aop-local-server` | `com.aop.local-server.nightly`, `aop-nightly-local-server` |
| Desktop app | `AOP.app`, `com.getaop.aop` | `AOP Nightly.app`, `com.getaop.aop.nightly`, nightly icon |
| App data (Electron `userData`, keychain item, single-instance lock) | `~/Library/Application Support/AOP` | `~/Library/Application Support/AOP Nightly` (follows the product name) |
| Feed origin | `https://getaop.com` | `https://getaop.com/nightly` |

Ports 25650/25660 are free: 25150/25160 belong to stable and `bun dev`, 25170 to the desktop dev server, 25250/25260 to `bun run local:aop`, 25350/25360 to the isolated desktop and 25400 to 25499 to the verify skill.

The places that change:

- `packages/infra/src/aop-paths.ts`: the default home (`AOP_HOME` still wins).
- `scripts/installer/entrypoint.ts`: data folder, PID file, log folder, default ports.
- `apps/local-server/src/update/`: `host-port.ts` (port), `restart.ts` (launchd label, systemd unit), `system.ts` (PID file), `install-layout.ts` (binary name), `release-feed.ts` (feed origin).
- `apps/cli/src/commands/client.ts`: default host URL.
- `packages/llm-provider` (`codex-cli.ts`, `pi.ts`): the `~/.aop` fallback.
- `apps/desktop`: `main.ts` (`setAppUserModelId`), `host-config/config-store.ts` (default port), `host-mode/launch.ts` (log folder; it also passes `AOP_HOME` to the host it starts), `updates/` (feed and pre-release handling), and the screens that print `25150` or the launchd label.
- `scripts/desktop/electron-builder-config.ts`: `appId`, `productName`, icon, DMG title and the updater `publish` URL.
- `scripts/release/macos-dmg.ts`: `AOP Nightly.app`, and the artifact names (`aop-nightly-macos-arm64.dmg`), so a nightly DMG is never mistaken for a release.
- `scripts/installer/install.sh`: a `CHANNEL="__AOP_CHANNEL__"` line, stamped like `DEFAULT_VERSION`. An unstamped copy is stable, so the stable script stays the same.

There is no OS deep-link scheme today: `app://` is registered only inside the app, so each app has its own. The dashboard shows a small "Nightly" mark when `/api/health` reports the nightly channel, so the two browser tabs can't be confused.

Shared on purpose: `~/.claude` (the same Claude Code login and skills), `gh` auth, and your repository checkouts.

## 2. ★ What nightly runs from

**Recommended: a separate, empty database. Try nightly on a real project by registering the same checkout.** AOP registers a repository by its path and makes thread worktrees under its own data folder, so stable and nightly can both use `~/workspace/aop-mono` with their own worktrees and branches (`aop/<slug>-<id>` names do not collide). Nothing is copied, and nothing a nightly does can reach stable's database.

Never share stable's database: a nightly migration would leave a schema stable refuses to open ("newer than this build supports").

Possible later step, not in this change: `aop-nightly import-projects`, a one-way copy of project and repository rows (no threads, no worktrees) from a snapshot of stable's database. Copying threads would hand nightly worktrees that stable owns, and archiving one in nightly would delete stable's worktree.

Shared-checkout caveats: both hosts run `git fetch` and `git worktree prune` in the same `.git`. Prune only drops entries whose folder is gone, so neither removes the other's worktrees. Two fetches at the same moment can fail on a ref lock, and that is retried like any other fetch failure.

## 3. Build trigger and versioning

**★ Trigger, recommended: after every push to `main` once `ci` passes**, through `workflow_run` on the `AOP CI` workflow. Also a manual `workflow_dispatch` from `main`. No schedule. Merges arrive a few times a day, the repository is public so runner minutes are free, and a build is ready about 30 minutes after a merge (notarization takes most of it).

- One concurrency group `nightly`, never cancelling a run in progress. GitHub keeps only the newest pending run, so a burst of merges builds once.
- Skip when the nightly feed already names this commit.
- `workflow_run` also fires for `ci` runs on pull requests, including from forks, and runs with the workflow's secrets. The job runs only when `workflow_run.event == 'push'`, `head_branch == 'main'` and the head repository is this one, and it builds `workflow_run.head_sha` only after checking that the commit is on `origin/main`. Pull request code never reaches the `nightly` environment.
- Alternative: a schedule (T3 Code's 30 minutes with a 6-hour gap) gives fewer builds and fewer host restarts, but a merge waits up to 6 hours. Doing both adds nothing.

**Versioning:** `<next patch>-nightly.<YYYYMMDD>.<run number>`, for example `0.10.7-nightly.20261002.14`, with the commit as build metadata on the host (`0.10.7-nightly.20261002.14+c213357`, shown in `aop-nightly --version` and `/api/health`) and in the feed (`commit`). Semver orders it: the run number grows within a day and the date across days, and every nightly sorts above `0.10.6` and below `0.10.7`. A short sha can't be in the ordered part because it does not sort. The app version is the same without `+commit`, because macOS bundle versions don't take build metadata.

The updaters today compare only `x.y.z` and refuse pre-releases (`packages/common/src/version.ts`). Nightly gets a comparison that orders the pre-release part. Stable keeps refusing every pre-release, which is a second guard on top of the separate feed.

## 4. Publishing

**No GitHub release; R2 only.** A nightly tag would be `v…`, and the `release tags` ruleset lets only admins create `v*` tags, so the workflow token couldn't create one. Hundreds of pre-releases would also bury the real releases. Every updater already reads R2, never GitHub.

Under `getaop.com/nightly/`:

| Path | What |
| --- | --- |
| `nightly/<version>/…` | The build's files: four host binaries, `runtime-assets.tar.gz`, both macOS DMGs and zips, `checksums.sha256` |
| `nightly/releases/<version>.json`, `.md` | The feed document (schema 1, plus `commit` and `channel`) and the notes: the commits since the previous nightly |
| `nightly/releases/latest.json` | Pointer: what nightly hosts and the nightly app read |
| `nightly/latest/latest-mac.yml` | Pointer: what a signed nightly app updates itself from (absolute URLs into `nightly/<version>/`) |
| `nightly/latest/aop-nightly-macos-{arm64,x64}.dmg` | Download links that never change |
| `nightly/install.sh` | Stamped with the version and `CHANNEL="nightly"`, uploaded last |
| `nightly/releases/index.json` | The published builds, newest first, for retention |

Stable's feed can't see these: stable reads `releases/latest.json` and `latest/latest-mac.yml` at the root, and nothing nightly writes is outside `nightly/`. No Windows nightly: you develop on a Mac, and Windows packaging would double the run time for a build nobody installs. Linux host binaries cost nothing extra, because Bun cross-compiles them on the same runner.

**Retention:** keep the last 10 builds. After the pointers flip, the deploy deletes the files of builds older than the 10th in `index.json`. One build is about 700 MB (two DMGs, two zips, four binaries), so 10 builds are about 7 GB.

**aop-web must route `/nightly/*`.** getaop.com is a Worker in the private `get-aop/aop-web`, and a path it doesn't route returns the site's 404 even when the object is in R2. That makes the deploy fail at its availability probe (what broke v0.10.5's first run). This needs a small change in aop-web, outside this repository.

## 5. ★ Signing and the `nightly` environment

Stable's `release` environment accepts only `v*` tags and waits for the owner's approval, so it can't run on every merge. **Recommended: a separate `nightly` environment that accepts only `main`, with no required reviewer, holding only what nightly needs:**

- Apple: `AOP_MACOS_CERTIFICATE_P12_BASE64`, `AOP_MACOS_CERTIFICATE_PASSWORD`, `AOP_MACOS_SIGN_IDENTITY`, `AOP_MACOS_NOTARIZE`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (and optionally `AOP_MACOS_KEYCHAIN_PASSWORD`). Same Developer ID. A Developer ID app needs no registered bundle id, so `com.getaop.aop.nightly` needs no Apple setup.
- Cloudflare: **a separate R2 bucket for nightly (`aop-nightly`) with an R2 API token scoped to that bucket only** (Object Read & Write). The deploy talks to it over R2's S3 API with the `aws` CLI that GitHub's runners carry, which can also list objects for retention. A wrangler token is account-wide: with it, a nightly run could overwrite stable's `install.sh`. A bucket-scoped key can't, so publishing stable keeps needing the owner's approval. aop-web routes `/nightly/*` to the second bucket.

The trade-off: **anything merged to `main` is built, signed with the Developer ID, notarized and published to the nightly feed with no one approving it.** Today only the owner can merge, and merges wait for `ci`. A malicious change that got merged would ship a signed app to nightly users (today, only you). The stable gate doesn't review code either: the owner approves a tag, not a diff. So the new exposure is "merged code is signed within the hour" instead of "at the next release". Leaked secrets aren't a new risk: the environment admits only `main`, and pull request runs never enter it.

Alternatives:

- **Unsigned nightly.** No Apple secrets outside `release`. The nightly app is ad-hoc signed, so it can't update itself (Squirrel.Mac refuses), shows "Update available" with a DMG link, and Gatekeeper asks on every new DMG. The host still updates itself, because host binaries are ad-hoc signed anyway. Workable, but the app half of "keeps itself up to date" is lost.
- **Local builds only** (`bun run release:local --channel nightly` on your Mac, with your own keychain). Nothing in CI holds a secret, but nothing happens unless you run it.

Recommended: the signed `nightly` environment with the separate bucket.

## 6. Self-update

The existing updaters, with the channel as a parameter:

- **Host.** `aop-nightly` reads `getaop.com/nightly/releases/latest.json`, downloads its platform's binary and `runtime-assets.tar.gz`, checks sha256, ad-hoc signs, runs `--version`, swaps with `.previous` kept, restarts through its own launchd label and rolls back unless `/api/health` reports the new version within 60 seconds. Same code as stable.
- **Automatic.** Stable checks once a day and the owner clicks "Update now". Nightly checks every hour and applies a new build on its own **when no agent turn is running** (otherwise it looks again in 10 minutes), so a restart never lands mid-turn by choice. Setting `update_auto_apply` (on by default in nightly, off in stable) turns this off, and "Update now" still works.
- **Mid-turn safety.** If a restart still happens mid-turn (a crash, a manual update), detached runs survive and the new host recovers them. #44 (on `main` since c2133573) keeps the MCP secret in `~/.aop-nightly/mcp-secret`, so a thread's AOP tools keep working across the restart.
- **Desktop.** The nightly app reads `nightly/latest/latest-mac.yml` with `allowPrerelease` on, and Squirrel.Mac swaps it when it restarts. Same signature gate: auto when Developer ID signed, a notice otherwise.

## 7. Install

```bash
curl -fsSL https://getaop.com/nightly/install.sh | sh
```

This puts `aop-nightly` and its dashboard in `~/.aop-nightly/bin`, links `~/.local/bin/aop-nightly`, writes `~/Library/LaunchAgents/com.aop.local-server.nightly.plist` (port 25650, logs in `~/.aop-nightly/logs`) and starts it. It never stops stable's service, frees only port 25650, and doesn't touch `~/.local/bin/aop` or `~/.local/bin/dashboard`. The app is `AOP Nightly.app` from `getaop.com/nightly/latest/aop-nightly-macos-arm64.dmg`. It adopts the nightly host on 25650, and starts the one it bundles when none is running.

On one Mac at once: two launchd agents, two ports, two data folders, two apps with different bundle ids, keychain items and app-data folders, and two CLIs (`aop` and `aop-nightly`). Their dashboards are `http://aop.localhost:25150` and `http://aop.localhost:25650`.

## 8. Using nightly to develop AOP

What can go wrong, and how it's handled:

- **Nightly restarts its own host while a thread works on AOP.** It applies an update only when no turn is running, and a turn interrupted anyway survives (detached runs, #44). A thread that merges its own PR starts the build that will restart its host about 30 minutes later, when it is usually done.
- **A broken `main` breaks the tool you'd fix it with.** Health-check rollback catches only a host that doesn't start. For one that starts but misbehaves, stable AOP stays installed and untouched: fix `main` from stable. `aop-nightly update --rollback` swaps back to `.previous`, and turning `update_auto_apply` off pins the current build.
- **A rolled-back nightly can't open a migrated database.** The migration ledger refuses a newer schema. The updater snapshots `~/.aop-nightly/projects.sqlite` before swapping in a build with a newer schema, and `--rollback` restores that snapshot with the binary.
- **Inherited environment.** A nightly thread inherits `AOP_LOCAL_SERVER_PORT=25650` and other `AOP_*` variables, like a stable thread does. Running AOP's tests from a nightly thread needs the same `unset AOP_*` (see the testing notes).
- **Two hosts, one checkout.** See the shared-checkout caveats in [What nightly runs from](#2--what-nightly-runs-from).

## Maintainer setup (once)

1. Settings → Environments → New `nightly`. Deployment branches: selected branches, `main` only. No required reviewers. Add the Apple secrets listed under Signing (values re-entered: secrets can't be copied out of `release`) and the nightly R2 secrets (`AOP_NIGHTLY_R2_ACCESS_KEY_ID`, `AOP_NIGHTLY_R2_SECRET_ACCESS_KEY`, `AOP_NIGHTLY_R2_ENDPOINT`, `AOP_NIGHTLY_R2_BUCKET`).
2. Cloudflare: create bucket `aop-nightly` and an R2 API token with Object Read & Write on that bucket only.
3. aop-web: bind the bucket in `wrangler.jsonc` and route `/nightly/*` to it in `worker.js`.
