# AOP Developer Guide

Product overview: [`README.md`](../README.md). PR process: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

When changing product surfaces, keep the main story consistent: AOP is a local control plane that turns chat sessions into workflow runs. The dashboard, CLI, and local-server should all reinforce that sessions are the front door, workflows automate the sequence, and workers provide concurrent capacity.

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
| `packages/license` | Optional paid-tier helpers |

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

Worker seats map to the `agent` domain plus task assignment. Workers are created and assigned from chat (worker card, assignment cards) and through the MCP tools; there is no Workers page. Legacy Hermes import API paths remain for older rows.

### Data paths

See `packages/infra/src/aop-paths.ts`: `~/.aop/aop.sqlite`, `~/.aop/repos/`, `~/.aop/worktrees/`, `~/.aop/agents/`.

## Workspace layout

```text
apps/
  cli/
  dashboard/           src/views/, src/ui/, src/workflow/
  local-server/        domain slices under src/
  license-server/      optional hosted LS proxy (operators only)
packages/
  common/  infra/  git-manager/  llm-provider/  license/
scripts/
  dev.ts  source-install.ts  (./install)
docs/
  WORKFLOW.md  architecture/  licensing.md  demo/
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
bun test:e2e
bun test:e2e:dashboard
bun test:coverage
bun check
```

Examples: `bun test apps/dashboard`, `bun test apps/local-server/src/workflow-engine`.

## Expectations

- Thin entrypoints → services → repositories ([`CLAUDE.md`](../CLAUDE.md)).
- Colocated `*.test.ts`; real assertions.
- User-visible changes: update root README, `apps/dashboard/README.md`, or `docs/WORKFLOW.md` as appropriate.

## Documentation map

| Path | Contents |
|------|----------|
| [`docs/WORKFLOW.md`](../docs/WORKFLOW.md) | Engine, signals, Pi direction |
| [`docs/architecture/`](../docs/architecture/) | Control-plane index + Pi factory contract |
| [`apps/dashboard/README.md`](../apps/dashboard/README.md) | UI map |
| [`apps/local-server/README.md`](../apps/local-server/README.md) | API index |
| [`apps/cli/README.md`](../apps/cli/README.md) | Commands |
| [`e2e-tests/README.md`](../e2e-tests/README.md) | E2E lanes |
| [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | Vendored methodology |
