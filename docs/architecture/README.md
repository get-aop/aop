# AOP architecture

AOP is a local-first control plane layered on top of external coding-agent CLIs. This guide covers the product/runtime boundary, local storage, detached execution, dashboard and desktop shells, Windows execution, updates, and factory limits.

## Local-first boundary

The Bun and Hono server hosts the API, orchestration engine, and dashboard at `http://aop.localhost:25150`. SQLite state lives at `~/.aop/aop.sqlite`. There is no hosted orchestrator, AOP account, product telemetry, or data collection.

AOP owns product state: registered repositories, worker memberships, task packages and assignments, workflow selection, worktrees, logs, runtime-event projections, and operator actions. The selected runtime CLI owns model/provider access, tool execution, conversational context, and any runtime-native subagent behavior.

## Supported runtimes

| Runtime | Provider id | Process shape |
| --- | --- | --- |
| Claude Code | `claude-code` | `claude` stream-json session |
| Codex CLI | `codex-cli` | `codex exec --json` with resume support |
| Grok | `grok-build` | `grok` runtime adapter |
| OpenCode | `opencode` | `opencode run --format json` |
| Pi | `pi` | `pi --mode json --print` with resumable follow-up |

Each adapter launches a detached process, ingests JSONL events, and persists a runtime session id when available. See [Runtimes](../RUNTIMES.md) for configuration and capabilities.

## Task and worker model

A worker is a named seat with role/focus metadata, runtime defaults, a default workflow, and repository memberships. Workers are created from chat (the worker card) and assigned through task cards; there is no Workers page. One worker runs at most one task at a time.

A task is assigned to at most one current writable worker. Its workflow executes in a worktree for the primary repository; supporting repositories are provided as read-only context. Execution is refused when the worker lacks a required membership.

Task lifecycle is `DRAFT`, `READY`, `RESUMING`, `WORKING`, `PAUSED`, `BLOCKED`, `DONE`, or `REMOVED`. See [Tasks](../TASKS.md) for lifecycle and task-detail actions.

## Detached executor and events

The local server spawns runtime CLIs detached from the dashboard and records the process/session identity. Active steps can survive a browser close or local-server restart. JSONL output is normalized into runtime events such as session start, assistant text, tool activity, attention requests, handoffs, verification evidence, completion, failure, or interruption.

Task detail streams current logs through SSE and reads historical execution events from SQLite. Token and cost usage attach to step runs when the provider reports them.

## Storage map

| Data | Location |
| --- | --- |
| SQLite product state | `~/.aop/aop.sqlite` |
| Task package | `~/.aop/repos/<repo-id>/tasks/<slug>/` |
| Task worktree | `~/.aop/worktrees/<repo-id>/<task-id>/` |
| Live step logs | `~/.aop/logs/<step-id>.jsonl` before SQLite flush |
| Codex auth/session home | `~/.aop/codex-home` |
| OpenCode state | `~/.aop/opencode` |
| Pi sessions | `~/.aop/pi-sessions` |

Repository removal resets AOP-owned repository data. Runtime authentication homes are deliberately preserved so agent logins survive a factory reset.

## Dashboard

The dashboard is Sessions-first:

- **Sessions** `/` — the rail, thread, composer, right panel, and terminal dock.
- **Settings** `/settings` — General + License, Repositories, Runtimes, Execution hosts, Workflows, About.

Task detail lives at `/tasks/:id` (deep links from chat cards). Legacy routes (`/chat`, `/pool`, `/workers`, `/metrics`, `/workflows/:id`) redirect to the home page. The rail footer shows the installed version, update action when available, and an execution host selector when applicable.

## Desktop and Windows

`AOP.app` is a Tauri shell around the local product. Setup checks Git, GitHub CLI, and supported agent runtimes, then opens official installation guides for anything missing instead of installing host tools itself.

Windows execution runs through a managed WSL distro; the design is recorded in the Windows-WSL execution ADR inside the repository.

## Updates

The local update service polls release metadata from getaop.com. When a newer version is available, the dashboard top bar exposes **Update**; the server coordinates the platform-specific update path without moving orchestration into a hosted service.

## Factory limits

- Global concurrent tasks: `max_concurrent_tasks`, default 5.
- Per-repository concurrent tasks: default 3.
- Per-worker running tasks: 1.
- Active workers: 4 Free, 8 Pro, unlimited Team.

## Related guides

- [Chat](../CHAT.md)
- [Tasks](../TASKS.md)
- [Workflows](../WORKFLOW.md)
- [Runtimes](../RUNTIMES.md)
- [MCP](../MCP.md)
