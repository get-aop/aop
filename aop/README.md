# AOP Developer Guide

Product overview: [`README.md`](../README.md). PR process: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

When changing product surfaces, keep the main story consistent: AOP is becoming Projects. A project is a coordinator conversation that spawns threads on Claude Code, Codex, and PI. The host runs on your own machine, is reached over Tailscale, and syncs to every computer you use. The dashboard, CLI, and local-server should all reinforce that story. The task, workflow, worker, and integration slices described below are being removed; do not build on them.

## Architecture

Local-first monorepo. **local-server** is the control plane; **dashboard** and **cli** are HTTP clients.

| Path | Role |
|------|------|
| `apps/local-server` | Hono API, SQLite, orchestrator, executor, workflows, integrations |
| `apps/dashboard` | React UI (Sessions, task detail, settings, workflow editor) |
| `apps/cli` | `aop` command client |
| `packages/common` | Shared types, SSE shapes, workflow runtime options |
| `packages/infra` | Logging, `aopPaths` (`~/.aop/…`) |
| `packages/git-manager` | Worktrees and squash handoff |
| `packages/llm-provider` | Agent CLI adapters |

There is no `apps/server` in this tree. Install serves the dashboard from local-server on port **25150** (`AOP_LOCAL_SERVER_PORT` / `AOP_LOCAL_SERVER_URL`).

## Product surfaces (current)

### Dashboard routes

| Route | UI |
|-------|-----|
| `/` | Sessions — rail, thread, composer, right panel, terminal dock |
| `/tasks/:taskId` | Task detail (logs, plan, specs, PR/CI actions) |
| `/settings` | General + License, Repositories, Runtimes, Execution hosts, Workflows, About |
| legacy paths | `/chat` `/pool` `/workers` `/metrics` `/workflows/:id` redirect to `/` |

### Local-server domains (vertical slices)

Under `apps/local-server/src/`:

- `orchestrator/` — watcher, queue processor, capacity
- `executor/` — worktrees, step launch, log flush
- `task/`, `repo/` — backlog and registration
- `agent/`, `channel/`, `worker-memory/` — workers, chat, memory search
- `workflow/`, `workflow-engine/` — definitions + runtime state machine
- `create-task/` — dashboard brainstorming API
- `integrations/linear`, `jira`, `github` — ticket import and PR flows
- `license/` — worker limits (optional paid keys)
- `prompts/` — step templates and methodology bodies

## Core concepts

### Task lifecycle

```text
DRAFT -> READY -> WORKING -> DONE
         |  ^         |
         |  +-- PAUSED, RESUMING
         +-- BLOCKED, REMOVED
```

### Workflows

Definitions live in SQLite (builder UI + built-in catalog in `workflow-engine/built-in-workflows.ts`). Runtime: `workflow-engine/workflow-state-machine.ts` + `workflow/service.ts`. Default name: `aop-default-gpt`.

### Workers

Worker seats map to the `agent` domain plus task assignment. Workers are created and assigned from chat (worker card, assignment cards) and through the MCP tools; there is no Workers page.

### Data paths

See `packages/infra/src/aop-paths.ts`: `~/.aop/projects.sqlite`, `~/.aop/repos/`, `~/.aop/worktrees/`, `~/.aop/agents/`.

## Workspace layout

```text
apps/
  cli/
  dashboard/           src/views/, src/ui/, src/workflow/
  local-server/        domain slices under src/
packages/
  common/  infra/  git-manager/  llm-provider/
scripts/
  dev.ts  source-install.ts  (./install)
docs/
  architecture/  adr/  install/
```

## Development

```bash
./install          # same as end users
bun dev            # full stack
bun dev --no-dashboard
```

## Verification

```bash
bun test
bun test:integration
bun test:coverage
bun check
```

Examples: `bun test apps/dashboard`, `bun test apps/local-server/src/chat-session`.

## Expectations

- Thin entrypoints → services → repositories ([`CLAUDE.md`](../CLAUDE.md)).
- Colocated `*.test.ts`; real assertions.
- User-visible changes: update root README, `apps/dashboard/README.md`, or the guides under `docs/` as appropriate.

## Documentation map

| Path | Contents |
|------|----------|
| [`docs/RUNTIMES.md`](../docs/RUNTIMES.md) | Supported agent CLIs and their process shape |
| [`docs/MCP.md`](../docs/MCP.md) | MCP tools and loopback authentication |
| [`docs/architecture/`](../docs/architecture/) | Legacy architecture overview |
| [`apps/dashboard/README.md`](../apps/dashboard/README.md) | UI map |
| [`apps/local-server/README.md`](../apps/local-server/README.md) | API index |
| [`apps/cli/README.md`](../apps/cli/README.md) | Commands |
| [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | Vendored methodology |
