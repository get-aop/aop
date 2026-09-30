# AOP Developer Guide

Product overview: [`README.md`](../README.md). PR process: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

Keep the main story consistent when you change product surfaces: AOP is built around Projects. A project is a coordinator conversation that spawns threads, each its own Claude Code session on its own git branch and worktree. Phase 1 runs Claude Code only; the Codex CLI and PI adapters stay in `packages/llm-provider` but are not exposed. The host runs on your own machine, is reached over Tailscale, and syncs to every computer you use. The dashboard, CLI, and local-server should all reinforce that story.

## Architecture

Local-first monorepo. **local-server** is the control plane; **dashboard**, **cli** and **desktop** are HTTP clients of it.

| Path | Role |
|------|------|
| `apps/local-server` | Hono API, SQLite, the chat engine that runs runtime turns, projects and threads, the MCP endpoint |
| `apps/dashboard` | React UI: Projects (Overview, coordinator chat, thread pane, project settings) and the host Settings dialog |
| `apps/cli` | `aop` command client |
| `apps/desktop` | Electron app: a client of one host that can also run the host on a Mac |
| `packages/common` | Shared types and Zod schemas: projects, threads, messages, the event log, the runtime catalog |
| `packages/infra` | Logging, tracing, TypeIDs, `aopPaths` (`~/.aop/…`) |
| `packages/git-manager` | Worktree lifecycle |
| `packages/llm-provider` | Agent CLI adapters, and the fake CLI used by tests and the verify skill |

Install serves the dashboard from local-server on port **25150** (`AOP_LOCAL_SERVER_PORT` / `AOP_LOCAL_SERVER_URL`). [Architecture](../docs/architecture/README.md) explains how the parts fit; [`docs/`](../docs/) has one guide per subsystem.

## Product surfaces

### Dashboard routes

| Route | UI |
|-------|-----|
| `/` | Every project as a card; New project |
| `/projects/:id` | The project's Overview: its threads grouped by what they need from you |
| `/projects/:id/chat` | The coordinator chat |
| `/projects/:id/threads/:threadId` | One thread: transcript, question, steering, pull request, changes |
| `/projects/:id/settings` | Project settings, memory, usage |
| any other path | Rewritten to `/` |

Host settings (General, Repositories, Runtimes, Devices, About) open as a dialog. [`apps/dashboard/README.md`](../apps/dashboard/README.md) has the detail.

### Local-server domains (vertical slices)

Under `apps/local-server/src/`:

- `project/`, `thread/` — projects, the coordinator, threads, their worktrees and pull requests
- `chat-session/` — the chat engine: turns, runs, the steer queue, recovery
- `scheduling/` — the cap on running turns and rate-limit waits
- `pull-request-watch/` — the pull request watcher and automatic fixes
- `event-log/` — the per-project event log and its stream
- `mcp/` — the tools the coordinator and threads call
- `repo/`, `session-git/`, `github-cli/` — repository registration, git state, the GitHub CLI
- `runtime-configuration/`, `usage/`, `settings/` — runtimes and models, token usage, host settings
- `auth/` — device tokens, pairing, request guard
- `db/` — migrations and schema

The full list, with the API prefixes, is in [`apps/local-server/README.md`](../apps/local-server/README.md).

## Core concepts

### Projects and threads

See [Architecture](../docs/architecture/README.md), [Threads and git](../docs/THREADS.md) and [MCP](../docs/MCP.md). A thread's status is one of `waiting-on-you`, `working`, `queued`, `rate-limited`, `ready-for-review`, `landing`, `idle` or `resolved` (`packages/common/src/projects/thread.ts`).

### Database migrations

`apps/local-server/src/db/migrations.ts` holds the ordered list. It is append-only: a version any build has applied never changes, so a schema change is a new version.

### Data paths

See `packages/infra/src/aop-paths.ts`: `~/.aop/projects.sqlite`, `~/.aop/worktrees/`, `~/.aop/projects/`, `~/.aop/logs/`, `~/.aop/chats/`.

## Workspace layout

```text
apps/
  cli/
  dashboard/           src/projects/, src/shell/, src/settings/, src/ui/
  desktop/
  local-server/        domain slices under src/
packages/
  common/  infra/  git-manager/  llm-provider/
scripts/
  dev.ts  source-install.ts  (./install)
docs/
  architecture/  adr/  install/
.claude/skills/verify/   drives an isolated stack in Chrome or the CLI
```

## Development

```bash
./install          # same as end users
bun dev            # full stack
bun dev --no-dashboard
```

## Verification

While you work, run the closest tests, Biome on the files you touched, and the typecheck of the workspace you changed:

```bash
bun test apps/local-server/src/chat-session
bunx biome check path/to/touched.ts
bun run --filter @aop/local-server typecheck
```

The full gate is for a PR or a repository-wide change: `bun check` (lint, `docs:check`, typecheck, build), then `bun test`, `bun test:integration` and `bun test:coverage` as needed. Drive a UI change in the running app with the verify skill (`.claude/skills/verify`).

## Expectations

- Thin entrypoints → services → repositories ([`CLAUDE.md`](../CLAUDE.md)).
- Colocated `*.test.ts`; real assertions.
- User-visible changes: update root README, `apps/dashboard/README.md`, or the guides under `docs/` as appropriate.

## Documentation map

| Path | Contents |
|------|----------|
| [`docs/HOST.md`](../docs/HOST.md) | Pairing, device tokens, `tailscale serve`, the desktop app |
| [`docs/THREADS.md`](../docs/THREADS.md) | A thread's worktree, branch and pull request |
| [`docs/SCHEDULING.md`](../docs/SCHEDULING.md) | The run cap and usage limits |
| [`docs/RUNTIMES.md`](../docs/RUNTIMES.md) | Supported agent CLIs and their process shape |
| [`docs/MCP.md`](../docs/MCP.md) | MCP tools and loopback authentication |
| [`docs/architecture/`](../docs/architecture/) | Architecture overview and subsystem guides |
| [`apps/dashboard/README.md`](../apps/dashboard/README.md) | UI map |
| [`apps/local-server/README.md`](../apps/local-server/README.md) | API index |
| [`apps/cli/README.md`](../apps/cli/README.md) | Commands |
| [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | Third-party code and licenses |
