---
name: verify
description: Launch an isolated AOP stack (Hono local-server + React dashboard + `aop` CLI) on free ports with a scratch AOP_HOME, drive it with the CLI or, when the task needs a browser check, with the session's computer-use tools (set by the AOP project's Computer Use setting), and capture screenshots, command output, and DB/git state as proof. Use to confirm a change to apps/dashboard, apps/local-server, or apps/cli works in the running app, beyond unit tests.
---

# Verify AOP in the running app

AOP is a local control plane: `apps/local-server` (Bun + Hono + SQLite) is the source of truth, `apps/dashboard` (React, Bun HTML imports) and `apps/cli` (`aop`) are HTTP clients. A verification run starts its own server and dashboard, so it never touches a released `aop` (`~/.aop`, port 25150), `bun dev` (`~/.aop-dev`, ports 25150/25160), or `bun run local:aop` (25250/25260).

Read `features/README.md` before driving; the matching feature file is the recipe. A proof that drives one convenient entry point is incomplete when the map lists others.

Surface: the dashboard (`/` lists projects, a project opens its thread grid, Settings is a dialog) and the CLI. The Electron app in `apps/desktop` is covered by [Desktop app](features/desktop.md): browser tools cannot drive its window, so that recipe drives it over the DevTools protocol (`scripts/desktop-cdp.ts`) and proves its cross-origin transport in a browser (Drive, below).

All commands run from the repo root. `S=.claude/skills/verify/scripts`.

## Launch

```bash
bun install                                      # once per checkout; the first run needs it
bun $S/verify-stack.ts start --name <run>        # server + dashboard dev server, detached
bun $S/seed.ts --name <run>                      # fixture repo registered as `repo`
bun $S/seed.ts --name <run> --fake-runtime       # same, plus the fake CLI as the default chat runtime
```

`start` prints the dashboard and API URLs and returns once `/api/health` reports `db.connected` and the dashboard serves HTML (about 1s). It picks two free ports in 25400-25499 and sets `AOP_HOME=.work/verify/<run>/home` and `AOP_DB_PATH`. Names isolate concurrent runs; the default name is `default`. `start` refuses a name that is still running. The variables of your shell pass through to both processes, which is how a run gets stub `claude`, `codex` and `pi` scripts first on `PATH`, or the host bound to the network for a remote-device check (`AOP_BIND_HOST`, `DASHBOARD_STATIC_PATH`; recipe `shell-pairing` in `features/projects-shell.md`). The dev dashboard listens on loopback only, so it never shows the pairing screen.

`seed` prints `{repoId, repoPath}` (plus `fakeRuntime` with `--fake-runtime`) and records them in `.work/verify/<run>/state.json`. Read ids from there.

## Doctor

Run first, and whenever anything looks off:

```bash
bun $S/verify-stack.ts doctor --name <run>       # read-only; exit 0 only if every line is PASS
```

It checks that both processes are this worktree's entry points, both ports are owned by this run's PIDs, `/api/health` is ok with a connected DB, the dashboard serves `/` and proxies `/api`, and the home is not `~/.aop` or `~/.aop-dev`. It does not check code freshness: the server is not started with `--watch`, so after editing `apps/local-server` run `stop` then `start` again. Dashboard changes hot-reload.

Never drive an instance this run did not start. If `doctor` fails, `stop` and start over.

## Drive

**CLI.** Use the wrapper so the CLI targets this run's server and home:

```bash
bun $S/verify-stack.ts aop --name <run> -- repo:init <path>
bun $S/verify-stack.ts env --name <run>          # exports, to run other commands against the stack
```

**Dashboard: only when the task needs a browser check, or the person asks for one.** A task needs one when its change is in what the dashboard shows or does and the API, the CLI and the tests cannot prove it. Server, CLI, docs and test-only changes do not; prove those with the CLI, `curl` and the tests.

Drive the dashboard only with the computer-use tools this session was given. In an AOP thread, the project's Computer Use setting decides them: **CUA** gives the `mcp__cua-driver__*` tools; **Model default** gives none. Never start a browser driver of your own (Playwright, headless Chrome over CDP, AppleScript; the desktop recipe's `desktop-cdp.ts` drives the Electron app, not a browser, and stays allowed), never hand the test to another agent CLI such as `codex`, and never drive the person's own Chrome profile. Without the tools, skip the dashboard drive, prove what you can through the CLI and the API, and say in the report that the dashboard was not driven and why.

With CUA, read `skill://cua-driver/SKILL.md` first (with ReadMcpResourceTool), and repeat one `session` label (`verify-<run>`) on every call:

1. Launch a throwaway browser: `browser_prepare` with `allow_launch: true` and `profile: {mode: "isolated_new"}`. It starts a separate Chromium on a fresh profile and never touches the person's profiles.
2. Bind it: `list_windows` for that browser's pid, then `get_browser_state` with the `pid` and `window_id`. It returns the `target_id` and the tab ids.
3. `browser_navigate` to the run's dashboard URL (`env.AOP_DASHBOARD_URL` in `.work/verify/<run>/state.json`).
4. Read the page with `get_browser_state` (`snapshot_format: "semantic_v2"`, a `query` with the `data-testid` name or the visible label from the feature file), act with `browser_click` and `browser_type` on the refs it returns (`replace: true` sets a field), and read the state again after each action: a newer snapshot or a navigation invalidates the old refs. Ask for `include_screenshot: true` at each checkpoint.
5. When done, `end_session`; if the browser you launched is still running, `kill_app` with its pid only.

The feature files were written for Claude in Chrome. Read their steps as intent: `find` and `read_page` are `get_browser_state` with a `query`; a "native value setter" fill is `browser_type` with `replace: true`; `javascript_tool` reads are `page` with `get_text` or `query_dom` (the mutating `page` actions are off by default; do not turn them on). The CUA tools read no browser console, so say in the report that it was not read.

**Sending chat messages runs the real runtime.** A chat, coordinator or thread message on a `claude-code` session spawns that CLI with the user's own auth, including unknown slash commands like `/status`, which are forwarded to it. Only `/clear` and `/alias` are handled by AOP; `/workflow` now reaches the runtime. Do not send chat text unless the feature file says to, or the user has agreed to that runtime spend.

The exception is a stack seeded with `--fake-runtime` (`bun $S/seed.ts --name <run> --fake-runtime`). That registers `packages/llm-provider/test-fixtures/fake-cli.ts` as a runtime and makes it the host's default runtime, so new projects and sessions spawn it instead of `claude` (projects created before the seed keep the built-in runtime: pick the fake in their settings › Models). It never calls a model, streams Claude-style JSONL, and supports `--resume`, so chat is free to drive. Confirm the session's `runtimeAlias` in `GET /api/chat-sessions` ends in `fake-cli.ts` before typing. Script a turn with a `[fake: ...]` marker in the message; see `features/sessions.md` and `packages/llm-provider/test-fixtures/README.md`.

## Evidence

Everything goes to `.work/verify/<run>/evidence/` (command output, API and DB reads, and a note of what each screenshot showed: CUA returns screenshots inline, not as files). Server and dashboard logs are in `.work/verify/<run>/logs/`. Record the feature ID and entry point beside each artifact.

Proof standards:

- Drive the real user path: the dashboard control, or the `aop` command a user types. Do not use test-only endpoints as the proof. The seed script uses HTTP and disk writes only to build baseline state.
- Capture the action and the resulting state, not only the final screen: the command and its exit code, then a second view of the result.
- Verify side effects next to what is visible: rows through the API (`/api/status` lists repos, `/api/chat-sessions` lists sessions), branches and files in the fixture repo with `git -C <repoPath>`.
- A screenshot is not proof until you have looked at it. Where the tools can read the browser console, read it after every flow and report new errors.
- `--fake-runtime` fakes the CLI only. The adapter, spawn, logs, git, SQLite, SSE, and the dashboard are real. Say so in the report; it does not verify a real model.

## Cleanup

```bash
bun $S/verify-stack.ts stop --name <run>
```

Kills only the two PIDs recorded for this run (process groups), deletes `home/` and `fixtures/`, and keeps `evidence/` and `logs/`. Run it after every failed attempt too. Confirm with `lsof -nP -iTCP:<port> -sTCP:LISTEN` that the ports are free. Never kill by process name: the user may be running `bun dev` or a released `aop`.

`.work/` is not in `.gitignore` in this repo, so it shows as untracked and `biome check .` scans it. Do not commit it.

## Helpers

| Script | Invocation |
| --- | --- |
| `scripts/verify-stack.ts` | `bun $S/verify-stack.ts <start\|doctor\|env\|aop\|restart-server\|stop> [--name run] [--crash] [-- aop args]`; `restart-server --crash` SIGKILLs only the server and restarts it on the same port and DB |
| `scripts/seed.ts` | `bun $S/seed.ts [--name run] [--fake-runtime]` after `start`; idempotent |
| `scripts/fake-gh.ts` | A fake GitHub CLI: put it first on the server's `PATH` as `gh` (a two-line wrapper), never the real one; `gh fake ...` scripts checks, reviews, conflicts, merges and closes; see `features/projects.md` for thread pull requests and the pull request watcher |
| `scripts/serve-proxy.ts` | `bun $S/serve-proxy.ts --listen <port> --target <api url> [--mode forwarded\|rewrite-host]`: a stand-in for `tailscale serve` (real Tailscale needs a tailnet). `forwarded` (default) adds `X-Forwarded-For`, `X-Forwarded-Host` and `Tailscale-User-*` and keeps the client's `Host`; `rewrite-host` sends `Host: 127.0.0.1` and no forwarding header, the case `docs/HOST.md` warns about. Event streams pass through. Open it as `http://localhost:<port>` (a cookie jar of its own next to `127.0.0.1` and `aop.localhost`) to see the pairing screen a proxied client gets |
| `scripts/desktop-cdp.ts` | `bun $S/desktop-cdp.ts <targets\|js\|jsfile\|shot\|errors> [argument]` against an app started with `--remote-debugging-port=9333`; see `features/desktop.md` |
| `scripts/seed-events.ts` | `bun $S/seed-events.ts [--name run] <project\|thread\|status\|message\|remove> ...` appends project events for the project stream; see `features/project-stream.md` |
