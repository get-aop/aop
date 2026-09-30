# Updates

An installed host (the compiled `aop` from `install.sh`) checks the published GitHub Releases once a day, shows a bar in the dashboard, and `aop update` or the owner's **Update now** replaces the binary and dashboard and restarts it. A verify stack runs from source, so it reports `supported: false` and shows nothing: this recipe builds two stamped binaries, installs the old one into a scratch folder and feeds it a fake release. Never use `~/.aop`, `~/.local/bin`, `~/Library/LaunchAgents`, `/Applications/AOP.app` or port 25150, and never stop the host the person is using.

## Sub-features

- `updates-check` reports a newer release through `aop update --check` and `GET /api/updates`.
- `updates-notice` shows the bar to the owner with **Update now** and to a paired device without it.
- `updates-apply` updates, restarts and reconnects the page on the new version.
- `updates-rollback` puts the old release back when the new binary starts and dies.

## Build and install

```bash
bun run build:release -- --target darwin-arm64        # dashboard + runtime-assets.tar.gz (the binary it builds is not used)
```

Compile the same entrypoint twice with `Bun.build` (`compile: {target: "bun-darwin-arm64", outfile}`, `minify: true`, `define: {BUILD_VERSION: JSON.stringify("0.9.51+old")}`; the second with `"0.10.0+new"`). Put the old one, `runtime-assets.tar.gz` and a `checksums.sha256` (`shasum -a 256`) in `<scratch>/oldrelease/v0.9.51/`; the new one with the same kind of files in `<scratch>/feed/`. Then, with `HOME=<scratch>/home`:

```bash
HOME=<scratch>/home AOP_SKIP_PREFLIGHT=1 AOP_RELEASES_URL=file://<scratch>/oldrelease \
  sh scripts/installer/install.sh --prefix <scratch>/prefix --version 0.9.51 --no-service
bun scripts/release/fake-feed.ts --dir <scratch>/feed --version 0.10.0 --port 25511 &
HOME=<scratch>/home PATH=<tripwire dir>:$PATH AOP_LOCAL_SERVER_PORT=25510 AOP_GITHUB_API_URL=http://127.0.0.1:25511 \
  <scratch>/prefix/bin/aop run --background --port 25510
```

`--no-service` keeps launchd and systemd out of it. The tripwire dir holds `claude`, `codex` and `pi` scripts that log and `exit 97`. The host serves its own dashboard at `http://127.0.0.1:25510/`; seed it with `seed.ts` by writing a `state.json` whose `env.AOP_LOCAL_SERVER_URL` is that address.

## Recipes

- **Check (`updates-check`).** `curl -s -X POST http://127.0.0.1:25510/api/updates/check` answers `available: true`, `latest: "0.10.0"`; `<scratch>/prefix/bin/aop update --check` (run with the same `HOME` and `AOP_GITHUB_API_URL`) prints `AOP 0.10.0 is available (you have 0.9.51)`.
- **Notice (`updates-notice`).** In the browser on `http://127.0.0.1:25510/`: `update-notice` reads "Update available (0.10.0)" with `update-release-notes-link` and `update-now-button`. Through `bun .claude/skills/verify/scripts/serve-proxy.ts --listen 25512 --target http://127.0.0.1:25510` and a pairing code, the same bar shows with no `update-now-button`, and `POST /api/updates/apply` answers `403`.
- **Apply (`updates-apply`).** Click `update-now-button`: `update-progress` appears, `<scratch>/home/.aop/logs/update.log` shows Downloading, Installing, Restarting, Updated, the page reloads itself (`performance.timeOrigin` changes), the bar is gone, About reads `v0.10.0`, and `GET /api/health` reports `0.10.0+new`. The data folder's `projects.sqlite` is the same file and the project is still listed.
- **Rollback (`updates-rollback`).** Serve a feed whose `aop-darwin-arm64` is a script that prints `aop/0.11.0+bad darwin-arm64 bun-v0` for `--version` and exits 1 otherwise (with matching checksums), then click Update now: within a minute `GET /api/updates` shows `state: "failed"` with "Rolled back to 0.9.51", the host answers again on 0.9.51, and `<scratch>/prefix/bin` holds only `aop` and `dashboard`.
- **Proof.** The requests, `update.log`, the health version before and after, and screenshots of the bar, the progress line and the new About. Say that GitHub was a fake feed and the runtime the fake CLI.
