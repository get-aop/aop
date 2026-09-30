# @aop/local-server

Local HTTP control plane for AOP: projects, threads, the chat engine that runs the agent CLI, and the REST/SSE API for the dashboard, the CLI and the desktop app.

The local server is where a project's coordinator and threads run. It stores projects and their memory, starts each thread in its own git worktree, launches the runtime CLI for every turn, records the reply and its usage, watches each thread's pull request, and enforces the cap on running turns. Clients follow a project over one event stream.

## Quick start

```bash
# From repo root: install sets AOP_LOCAL_SERVER_PORT / URL
./install

# Manual: AOP_LOCAL_SERVER_PORT must be set, and outside production so must AOP_DASHBOARD_URL
# (see packages/common/src/env.ts)
bun run apps/local-server/src/run.ts

cd apps/local-server && bun run dev   # watch mode
```

Default after install: **`http://aop.localhost:25150`** (serves dashboard static files from `DASHBOARD_STATIC_PATH`).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                 Local Server (Bun + Hono)                     │
│  Projects · Threads · Chat sessions · Repos · MCP            │
│  SQLite: ~/.aop/projects.sqlite                                    │
└────────────────────────────┬─────────────────────────────────┘
                             │ REST + SSE
                    ┌────────┴────────┐
                    │                 │
               ┌────▼────┐      ┌─────▼─────┐
               │   CLI   │      │ Dashboard │
               └─────────┘      └───────────┘
```

## API overview

Registered in `src/app.ts`:

| Prefix | Domain |
|--------|--------|
| `/api/health` | Liveness (no credentials) |
| `/api/auth` | Device pairing, session cookie, device list and revocation; see [Running the AOP host](../../docs/HOST.md) |
| `/api/status` | Registered repos and summaries |
| `/api/projects` | Projects: settings, pause/archive/restore, the coordinator chat, memory files, the project event stream |
| `/api/projects/:id/threads`, `/api/threads` | A project's threads: start, steer, answer a question, stop, read; each thread's worktree, pull request (open, merge, sync) and resolve, see [Threads and git](../../docs/THREADS.md) |
| `/api/projects/:id/messages/:messageId/suggestions/:suggestionId` | Answers to the threads the coordinator proposes: start (once), skip, undo a skip; see [The coordinator chat](../../docs/architecture/coordinator-chat.md#suggested-threads) |
| `/api/chat-sessions` | Chat sessions that belong to no project: messages, runs, session git |
| `/api/repos` | Register/remove repositories |
| `/api/settings` | Key/value settings |
| `/api/runtime-configuration` | Runtime catalog: providers, models and their thinking levels |
| `/api/usage` | Token and cost usage |
| `/api/mcp` | The AOP MCP server (its tools depend on the calling session) |
| `/api/fs` | Directory browse for settings UI |

Every route except health, `POST /api/auth/pair`, and `/api/mcp` needs a device token, its session cookie, or a direct request from the host itself. Who may call what is in `src/auth/route-policy.ts`.

## Environment

| Variable | Purpose |
|----------|---------|
| `AOP_LOCAL_SERVER_PORT` | Listen port (required at runtime) |
| `AOP_BIND_HOST` | Listen address; defaults to `127.0.0.1` |
| `AOP_ALLOWED_ORIGINS` | Extra browser origins allowed to call the API, comma-separated |
| `AOP_LOCAL_SERVER_URL` | Address the CLI and the install scripts use to reach the server |
| `DASHBOARD_STATIC_PATH` | Built dashboard assets (install sets this) |
| `AOP_HOME` | Override `~/.aop` data root |
| `AOP_DB_PATH` | Override the SQLite file (default `<AOP_HOME>/projects.sqlite`) |
| `AOP_MCP_URL` | Address the host's own agents use to reach `/api/mcp`, when the server is not bound to loopback |
| `AOP_PR_POLL_INTERVAL_MS` | Fixed pace for the pull request watcher; see [Threads and git](../../docs/THREADS.md#watching-the-pull-request) |

Paths: `@aop/infra` `aopPaths` — DB `projects.sqlite`, worktrees under `worktrees/<repo-id>/<thread-id>`, run logs under `logs/chat-sessions/<session-id>`.

## Source layout

```text
src/
  app.ts, run.ts, server.ts, context.ts, config.ts
  chat-session/       the chat engine: turns, runs, steer queue, recovery
  project/, thread/   projects, the coordinator, threads, their worktrees and pull requests
  pull-request-watch/ the pull request watcher and automatic fixes
  scheduling/         the cap on running turns, rate-limit waits
  repo/, session-git/ repo registration, git state
  process/            process supervision
  runtime-configuration/  runtime catalog
  event-log/  the project event stream
  auth/               device tokens, pairing, cookie sessions, request guard
  github-cli/, mcp/
  usage/, settings/, health/, db/, fs/
```

## Scripts

```bash
bun run dev
bun run test
bun run typecheck
```

## Service install

Use `./install` from the repo root for systemd (Linux) or launchd (macOS) user services generated by `scripts/source-install.ts`.
