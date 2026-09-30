---
name: verify
description: Launch an isolated AOP stack (Hono local-server + React dashboard + `aop` CLI) on free ports with a scratch AOP_HOME, drive it in Chrome or the CLI, and capture screenshots, command output, and DB/git state as proof. Use to confirm a change to apps/dashboard, apps/local-server, or apps/cli works in the running app, beyond unit tests.
---

# Verify AOP in the running app

AOP is a local control plane: `apps/local-server` (Bun + Hono + SQLite) is the source of truth, `apps/dashboard` (React, Bun HTML imports) and `apps/cli` (`aop`) are HTTP clients. A verification run starts its own server and dashboard, so it never touches a released `aop` (`~/.aop`, port 25150), `bun dev` (`~/.aop-dev`, ports 25150/25160), or `bun run local:aop` (25250/25260).

Read `features/README.md` before driving; the matching feature file is the recipe. A proof that drives one convenient entry point is incomplete when the map lists others.

Surface: the dashboard (`/` lists projects, a project opens its thread grid, Settings is a dialog) and the CLI. The Electron app in `apps/desktop` is covered by [Desktop app](features/desktop.md): Claude in Chrome cannot drive its window, so that recipe drives it over the DevTools protocol (`scripts/desktop-cdp.ts`) and proves its cross-origin transport in Chrome.

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

**Dashboard: Claude in Chrome, required for every finished task.** The user requires the agent to test each finished task in the real browser, and there is no scripted fallback. Load the tools in one call with ToolSearch (`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__tabs_close_mcp`), call `tabs_context_mcp` first, and work in a NEW tab on the run's dashboard URL (`env.AOP_DASHBOARD_URL` in `.work/verify/<run>/state.json`). Batch the predictable steps with `browser_batch`. Prefer `find` or `read_page` with the `data-testid` names listed in the feature files over pixel coordinates. After each flow run `read_console_messages` with `onlyErrors: true`, and take screenshots with `save_to_disk: true`. Report the steps and what you saw. Close the tab you opened when done.

Typing: the tab you drive is usually not the one in front (`document.visibilityState` is `hidden`, and other agents' tabs share the group), and then the `computer` tool's `type` and `key` actions can deliver no key events at all: the field keeps focus and stays empty, with no error. Fill fields with a native value setter and a bubbling `input` event in `javascript_tool` (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text); el.dispatchEvent(new Event('input', {bubbles: true}))`, `HTMLInputElement` for inputs), read the value back, then click or press the real control. Clicks and `find` refs are not affected. A hidden tab also throttles timers, so keep a `javascript_tool` call under about 30 seconds (it times out at 45).

If Chrome shows an error page for a stack that `curl` reaches (`Frame with ID 0 is showing error page`), the tools are almost certainly driving a Chrome on a different computer. Call `list_connected_browsers`. If a browser with `isLocal: false` (for example a Windows Chrome) is `inUse`, ask the user which browser to use with AskUserQuestion, one option per browser, then call `select_browser`. Never pick a browser yourself. Do not work around it with another browser driver.

**Sending chat messages runs the real runtime.** A chat, coordinator or thread message on a `claude-code` session spawns that CLI with the user's own auth, including unknown slash commands like `/status`, which are forwarded to it. Only `/clear` and `/alias` are handled by AOP; `/workflow` now reaches the runtime. Do not send chat text unless the feature file says to, or the user has agreed to that runtime spend.

The exception is a stack seeded with `--fake-runtime` (`bun $S/seed.ts --name <run> --fake-runtime`). That registers `packages/llm-provider/test-fixtures/fake-cli.ts` as the first runtime configuration, so new sessions spawn it instead of `claude`. It never calls a model, streams Claude-style JSONL, and supports `--resume`, so chat is free to drive. Confirm the session's `runtimeAlias` in `GET /api/chat-sessions` ends in `fake-cli.ts` before typing. Script a turn with a `[fake: ...]` marker in the message; see `features/sessions.md` and `packages/llm-provider/test-fixtures/README.md`.

## Evidence

Everything goes to `.work/verify/<run>/evidence/` (the paths `save_to_disk` returns for screenshots, a `console.log` you write from `read_console_messages`, anything else you save). Server and dashboard logs are in `.work/verify/<run>/logs/`. Record the feature ID and entry point beside each artifact.

Proof standards:

- Drive the real user path: the dashboard control, or the `aop` command a user types. Do not use test-only endpoints as the proof. The seed script uses HTTP and disk writes only to build baseline state.
- Capture the action and the resulting state, not only the final screen: the command and its exit code, then a second view of the result.
- Verify side effects next to what is visible: rows through the API (`/api/status` lists repos, `/api/chat-sessions` lists sessions), branches and files in the fixture repo with `git -C <repoPath>`.
- A screenshot is not proof until you have looked at it. Read the browser console after every flow and report new errors.
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
