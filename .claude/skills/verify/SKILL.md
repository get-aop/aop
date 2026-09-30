---
name: verify
description: Launch an isolated AOP stack (Hono local-server + React dashboard + `aop` CLI) on free ports with a scratch AOP_HOME, drive it in Chrome or the CLI, and capture screenshots, command output, and DB/git state as proof. Use to confirm a change to apps/dashboard, apps/local-server, or apps/cli works in the running app, beyond unit tests.
---

# Verify AOP in the running app

AOP is a local control plane: `apps/local-server` (Bun + Hono + SQLite) is the source of truth, `apps/dashboard` (React, Bun HTML imports) and `apps/cli` (`aop`) are HTTP clients. A verification run starts its own server and dashboard, so it never touches a released `aop` (`~/.aop`, port 25150), `bun dev` (`~/.aop-dev`, ports 25150/25160), or `bun run local:aop` (25250/25260).

Read `features/README.md` before driving; the matching feature file is the recipe. A proof that drives one convenient entry point is incomplete when the map lists others.

Surface: the dashboard (`/` Sessions, `/tasks/:id`, `/settings`) and the CLI. The Electron app in `apps/desktop` is not covered.

All commands run from the repo root. `S=.claude/skills/verify/scripts`.

## Launch

```bash
bun install                                      # once per checkout; the first run needs it
bun $S/verify-stack.ts start --name <run>        # server + dashboard dev server, detached
bun $S/seed.ts --name <run>                      # fixture repo, workflow, worker, one assigned DRAFT task
bun $S/seed.ts --name <run> --fake-runtime       # same, plus the fake CLI as the default chat runtime
```

`start` prints the dashboard and API URLs and returns once `/api/health` reports `db.connected` and the dashboard serves HTML (about 1s). It picks two free ports in 25400-25499 and sets `AOP_HOME=.work/verify/<run>/home`, `AOP_DB_PATH`, and `AOP_TEST_MODE=true`. Test mode routes task steps to the deterministic `e2e-fixture` agent, so task runs cost nothing and finish in about a second. Names isolate concurrent runs; the default name is `default`. `start` refuses a name that is still running.

`seed` prints `{repoId, repoPath, taskId, agentId, workflow}` and records them in `.work/verify/<run>/state.json`. Read ids from there.

## Doctor

Run first, and whenever anything looks off:

```bash
bun $S/verify-stack.ts doctor --name <run>       # read-only; exit 0 only if every line is PASS
```

It checks that both processes are this worktree's entry points, both ports are owned by this run's PIDs, `/api/health` is ok with a connected DB, the dashboard serves `/` and proxies `/api`, the home is not `~/.aop` or `~/.aop-dev`, and test mode is on. It does not check code freshness: the server is not started with `--watch`, so after editing `apps/local-server` run `stop` then `start` again. Dashboard changes hot-reload.

Never drive an instance this run did not start. If `doctor` fails, `stop` and start over.

## Drive

**CLI.** Use the wrapper so the CLI targets this run's server and home:

```bash
bun $S/verify-stack.ts aop --name <run> -- status --json
bun $S/verify-stack.ts aop --name <run> -- task:ready <taskId>
bun $S/verify-stack.ts env --name <run>          # exports, to run other commands against the stack
```

**Dashboard: Claude in Chrome, required for every finished task.** The user requires the agent to test each finished task in the real browser, and there is no scripted fallback. Load the tools in one call with ToolSearch (`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__tabs_close_mcp`), call `tabs_context_mcp` first, and work in a NEW tab on the run's dashboard URL (`env.AOP_DASHBOARD_URL` in `.work/verify/<run>/state.json`). Batch the predictable steps with `browser_batch`. Prefer `find` or `read_page` with the `data-testid` names listed in the feature files over pixel coordinates. After each flow run `read_console_messages` with `onlyErrors: true`, and take screenshots with `save_to_disk: true`. Report the steps and what you saw. Close the tab you opened when done.

If Chrome shows an error page for a stack that `curl` reaches (`Frame with ID 0 is showing error page`), the tools are almost certainly driving a Chrome on a different computer. Call `list_connected_browsers`. If a browser with `isLocal: false` (for example a Windows Chrome) is `inUse`, ask the user which browser to use with AskUserQuestion, one option per browser, then call `select_browser`. Never pick a browser yourself. Do not work around it with another browser driver.

**Sending chat messages runs the real runtime.** A Sessions message on a `claude-code` or `codex-cli` session spawns that CLI with the user's own auth, including unknown slash commands like `/status`, which are forwarded to it. Only `/clear` and `/alias` are handled by AOP; `/workflow` now reaches the runtime. Do not send chat text unless the feature file says to, or the user has agreed to that runtime spend.

The exception is a stack seeded with `--fake-runtime` (`bun $S/seed.ts --name <run> --fake-runtime`). That registers `packages/llm-provider/test-fixtures/fake-cli.ts` as the first runtime configuration, so new sessions spawn it instead of `claude`. It never calls a model, streams Claude-style JSONL, and supports `--resume`, so chat is free to drive. Confirm the session's `runtimeAlias` in `GET /api/chat-sessions` ends in `fake-cli.ts` before typing. Script a turn with a `[fake: ...]` marker in the message; see `features/sessions.md` and `packages/llm-provider/test-fixtures/README.md`.

## Evidence

Everything goes to `.work/verify/<run>/evidence/` (the paths `save_to_disk` returns for screenshots, a `console.log` you write from `read_console_messages`, anything else you save). Server and dashboard logs are in `.work/verify/<run>/logs/`. Record the feature ID and entry point beside each artifact.

Proof standards:

- Drive the real user path: the dashboard control, or the `aop` command a user types. Do not use test-only endpoints as the proof. The seed script uses HTTP and disk writes only to build baseline state.
- Capture the action and the resulting state, not only the final screen: the command and its exit code, then a second view of the result.
- Verify side effects next to what is visible: task status through `aop status <taskId> --json`, branches and files in the fixture repo with `git -C <repoPath>`, rows through the API.
- A screenshot is not proof until you have looked at it. Read the browser console after every flow and report new errors.
- Test mode fakes the agent only. Task steps, git, SQLite, SSE, and the dashboard are real. Say so in the report; it does not verify a real runtime.

## Cleanup

```bash
bun $S/verify-stack.ts stop --name <run>
```

Kills only the two PIDs recorded for this run (process groups), deletes `home/` and `fixtures/`, and keeps `evidence/` and `logs/`. Run it after every failed attempt too. Confirm with `lsof -nP -iTCP:<port> -sTCP:LISTEN` that the ports are free. Never kill by process name: the user may be running `bun dev` or a released `aop`.

`.work/` is not in `.gitignore` in this repo, so it shows as untracked and `biome check .` scans it. Do not commit it.

## Helpers

| Script | Invocation |
| --- | --- |
| `scripts/verify-stack.ts` | `bun $S/verify-stack.ts <start\|doctor\|env\|aop\|stop> [--name run] [-- aop args]` |
| `scripts/seed.ts` | `bun $S/seed.ts [--name run] [--fake-runtime]` after `start`; idempotent |
