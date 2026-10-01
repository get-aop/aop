# Updates

An installed host (the compiled `aop` from `install.sh`) checks the release feed on getaop.com (`/releases/latest.json`) once a day, shows a bar in the dashboard, and `aop update` or the owner's **Update now** replaces the binary and dashboard and restarts it. A verify stack runs from source, so it reports `supported: false` and shows nothing: this recipe builds two stamped binaries, installs the old one into a scratch folder and feeds it a fake release. Never use `~/.aop`, `~/.local/bin`, `~/Library/LaunchAgents`, `/Applications/AOP.app` or port 25150, and never stop the host the person is using.

## Sub-features

- `updates-check` reports a newer release through `aop update --check` and `GET /api/updates`.
- `updates-notice` shows the bar to the owner with **Update now** and to a paired device without it.
- `updates-apply` updates, restarts and reconnects the page on the new version.
- `updates-rollback` puts the old release back when the new binary starts and dies.
- `updates-checksum` refuses a download that does not match the feed's sha256 and changes nothing.
- `updates-runs-survive` a chat turn that is running when the host restarts finishes, and its reply is recorded by the new host.

## Build and install

```bash
bun run build:release -- --target darwin-arm64        # dashboard + runtime-assets.tar.gz (the binary it builds is not used)
```

Compile the same entrypoint (`scripts/installer/entrypoint.ts`) twice with `Bun.build` (`compile: {target: "bun-darwin-arm64", outfile}`, `minify: true`, `define: {BUILD_VERSION: JSON.stringify("0.9.51+old")}`; the second with `"0.10.0+new"`). Put the old one as `aop-darwin-arm64`, `runtime-assets.tar.gz` and a `checksums.sha256` (`shasum -a 256`) in `<scratch>/oldrelease/v0.9.51/`; the new one and `runtime-assets.tar.gz` in `<scratch>/feed/` (the fake feed writes the checksums and builds the feed with the release's own code). Write the environment to a file and source it: under zsh, `env -i $VARS` with the assignments in one variable passes ONE variable (`HOME=... PATH=...`), and the host then keeps its data in a folder named after that whole string.

```bash
cat > <scratch>/env.sh <<EOF
export HOME=<scratch>/home
export PATH=<tripwire dir>:<dir of bun>:/usr/bin:/bin:/usr/sbin:/sbin
export AOP_LOCAL_SERVER_PORT=25510 AOP_DASHBOARD_PORT=25512
export AOP_RELEASE_FEED_URL=http://127.0.0.1:25511
EOF
env -i sh -c '. <scratch>/env.sh && AOP_SKIP_PREFLIGHT=1 AOP_RELEASES_URL=file://<scratch>/oldrelease sh scripts/installer/install.sh --prefix <scratch>/prefix --version 0.9.51 --no-service'
bun scripts/release/fake-feed.ts --dir <scratch>/feed --version 0.10.0 --port 25511 &
env -i sh -c '. <scratch>/env.sh && <scratch>/prefix/bin/aop run --background --port 25510'
```

`env -i` keeps the thread's own `AOP_*` variables (`AOP_BUILD_VERSION`, `AOP_LOCAL_SERVER_PORT`, ...) away from the scratch host.

`--no-service` keeps launchd and systemd out of it. The tripwire dir holds `claude`, `codex` and `pi` scripts that log and `exit 97`. The host serves its own dashboard at `http://127.0.0.1:25510/`; seed it with `seed.ts` by writing a `state.json` whose `env.AOP_LOCAL_SERVER_URL` is that address.

## Recipes

- **Check (`updates-check`).** `curl -s -X POST http://127.0.0.1:25510/api/updates/check` answers `available: true`, `latest: "0.10.0"`; `<scratch>/prefix/bin/aop update --check` (run under the same `env.sh`) prints `AOP 0.10.0 is available (you have 0.9.51)`.
- **Notice (`updates-notice`).** In the browser on `http://127.0.0.1:25510/`: `update-notice` reads "Update available (0.10.0)" with `update-release-notes-link` and `update-now-button`. Through `bun .claude/skills/verify/scripts/serve-proxy.ts --listen 25512 --target http://127.0.0.1:25510` and a pairing code, the same bar shows with no `update-now-button`, and `POST /api/updates/apply` answers `403`.
- **Apply (`updates-apply`).** Click `update-now-button`: `update-progress` appears, `<scratch>/home/.aop/logs/update.log` shows Downloading, Installing, Restarting, Updated, the page reloads itself (`performance.timeOrigin` changes), the bar is gone, About reads `v0.10.0`, and `GET /api/health` reports `0.10.0+new`. The data folder's `projects.sqlite` is the same file and the project is still listed.
- **Rollback (`updates-rollback`).** Serve a feed whose `aop-darwin-arm64` is a script that prints `aop/0.11.0+bad darwin-arm64 bun-v0` for `--version` and exits 1 otherwise (with matching checksums), then click Update now: within a minute `GET /api/updates` shows `state: "failed"` with "Rolled back to 0.9.51", the host answers again on 0.9.51, and `<scratch>/prefix/bin` holds only `aop` and `dashboard`.
- **Checksum (`updates-checksum`).** Serve a feed, then append a byte to its `aop-darwin-arm64` on disk (the feed keeps the digest it computed at start) and `POST /api/updates/apply`: within seconds `GET /api/updates` shows `state: "failed"` with "Checksum verification failed for aop-darwin-arm64", `<scratch>/prefix/bin` holds only `aop` and `dashboard`, and the health version is unchanged.
- **Runs survive (`updates-runs-survive`).** Write `.work/verify/<run>/state.json` as `{"dir": "<scratch>", "home": "<scratch>/home", "env": {"AOP_LOCAL_SERVER_URL": "http://127.0.0.1:25510"}}` and run `bun $S/seed.ts --name <run> --fake-runtime`. Create a project (`POST /api/projects` with the repo id) and send `long turn [fake: steps=4 delay=4000 say="survived the update"]` to it. While `pgrep -f fake-cli.ts` shows the run, apply the update: the same pid outlives the restart, and once it exits `chat_runs` in `<scratch>/home/.aop/projects.sqlite` reads `completed` and the assistant message is "survived the update".
- **Proof.** The requests, `update.log`, the health version before and after, and screenshots of the bar, the progress line and the new About. Say that getaop.com was a fake feed and the runtime the fake CLI.
