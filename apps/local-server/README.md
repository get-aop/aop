# @aop/local-server

Local HTTP control plane for AOP: orchestration, workflows, workers, integrations, and the REST/SSE API for the CLI and dashboard.

The local server is where AOP turns manual agent work into automated runs. It watches Ready tasks, resolves the selected workflow, creates isolated worktrees, launches the provider runtime for each step, records logs and events, and enforces worker capacity so multiple tasks can move through the Pool at the same time.

## Quick start

```bash
# From repo root — install sets AOP_LOCAL_SERVER_PORT / URL
./install

# Manual (env must define port + URL, see packages/common env.ts)
bun run apps/local-server/src/run.ts

cd apps/local-server && bun run dev   # watch mode
```

Default after install: **`http://aop.localhost:25150`** (serves dashboard static files from `DASHBOARD_STATIC_PATH`).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                 Local Server (Bun + Hono)                     │
│  Orchestrator · Executor · Workflow engine · Integrations    │
│  SQLite: ~/.aop/aop.sqlite                                    │
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
| `/api/health` | Liveness, orchestrator subsystem status |
| `/api/status`, `/api/refresh` | Capacity, repos, tasks; manual reconcile |
| `/api/repos` | Register/remove repositories |
| `/api/tasks/resolve/:identifier` | Resolve task by id, name, or index |
| `/api/events` | SSE dashboard feed |
| `/api/executions/:id/logs` | SSE step log stream |
| `/api/executions/:id/runtime-events` | Sanitized runtime event timeline |
| `/api/agents` | Worker profiles (`POST /workers`, list, archive; legacy Hermes import under `/hermes/*`) |
| `/api/agent-memory` | Memory search for workers |
| `/api/channels` | Private/group worker chat |
| `/api/workflows` | Workflow + step-block CRUD |
| `/api/create-task` | Guided task creation |
| `/api/run-task` | Scaffold task docs by name |
| `/api/settings` | Key/value settings |
| `/api/linear`, `/api/jira`, `/api/github` | Integrations |
| `/api/metrics` | Aggregated task metrics |
| `/api/sessions` | Interactive session hooks |
| `/api/fs` | Directory browse for settings UI |

Task routes are mounted under repo handlers; see `repo/routes` and `task/routes`.

## Environment

| Variable | Purpose |
|----------|---------|
| `AOP_LOCAL_SERVER_PORT` | Listen port (required at runtime) |
| `AOP_LOCAL_SERVER_URL` | Public base URL for callbacks and CLI |
| `DASHBOARD_STATIC_PATH` | Built dashboard assets (install sets this) |
| `AOP_HOME` | Override `~/.aop` data root |
| `AOP_LINEAR_CLIENT_ID`, … | Integration fallbacks |
| `AOP_CHECKOUT_PRO_URL`, `AOP_CHECKOUT_TEAM_URL` | Optional checkout links shown in Settings → License |

Paths: `@aop/infra` `aopPaths` — DB `aop.sqlite`, tasks under `repos/<id>/tasks/`, worktrees under `worktrees/<id>/`.

## Task lifecycle

```text
DRAFT → READY → WORKING → DONE
              ↓
    PAUSED / RESUMING / BLOCKED / REMOVED
```

Task *content* lives under `~/.aop/repos/<repo-id>/tasks/<slug>/`. Legacy repo-local `docs/tasks/` is discovered only when `discover_legacy_repo_tasks` is enabled (default off).

## Workflows

- Catalog: `workflow-engine/built-in-workflows.ts` (`aop-default-gpt`, …)
- Runtime: `workflow/service.ts`, `workflow-engine/workflow-state-machine.ts`
- Prompts: `prompts/templates/*.md.hbs`, methodology under `prompts/methodology/`
- Queue processor: claims Ready tasks, starts worker workflows, and advances transitions without requiring manual CLI skill chaining

See [`docs/WORKFLOW.md`](../../docs/WORKFLOW.md) for the operator-facing reference.

### Engine internals

- `workflow-engine/workflow-state-machine.ts` evaluates the next transition for a completed step: failure status first (a failed step's signal is treated as unreliable), then signal match, then `__none__`, then status match; no match resolves to blocked. Loop caps use `maxIterations` with `onMaxIterations` overflow targets.
- `workflow-engine/built-in-workflows.ts` is the typed catalog, validated at module load and seeded lazily into SQLite (`workflow/sync.ts`); user-edited rows win over built-ins, and `aop-default-gpt` definitions are migrated at read time (`workflow-engine/aop-default-gpt-migrations.ts`). The YAML loader (`workflow-loader.ts`) is legacy import/testing compatibility only.
- `workflow-engine/step-command-generator.ts` turns a step into the executor command payload, including the per-step `agent` override; `prompts/template-loader.ts` resolves the step's prompt template.
- Execution flow: the queue processor claims a READY task by setting it WORKING, the executor creates the git worktree and spawns the provider CLI detached (it survives server restarts), the log flusher copies JSONL output into `step_logs` every 10s and triggers runtime-event projection, and on completion the executor detects success/failure plus an optional signal, completes the step through `workflow/service.ts`, and launches the next step in-process.
- Recovery on startup classifies running steps: reattach to a live agent process (claude/codex command lines), infer the outcome from the JSONL log when the process is gone, or reset the task to READY when neither exists.

## Source layout

```text
src/
  app.ts, run.ts, context.ts
  orchestrator/       watcher, queue, capacity
  executor/           worktrees, agents, logs
  task/, repo/        backlog
  agent/, channel/, worker-memory/
  workflow/, workflow-engine/
  create-task/, run-task/
  integrations/       linear, jira, github
  events/             SSE + log tailing
  prompts/            templates + methodology
  settings/, health/, session/
```

## Scripts

```bash
bun run dev
bun run test
bun run typecheck
```

## Service install

Use `./install` from the repo root for systemd (Linux) or launchd (macOS) user services generated by `scripts/source-install.ts`.
