# AOP architecture

AOP is a local-first control plane layered on top of external coding-agent CLIs. This guide covers the product/runtime boundary, local storage, detached execution, dashboard and desktop shells, and updates.

> **Legacy page.** It describes the previous Sessions, task, and workflow product, which the rewrite around Projects (see the [README](../../README.md)) is removing. It is rewritten as the replacement lands; do not read it as the Projects design.

## Local-first boundary

The Bun and Hono server hosts the API, orchestration engine, and dashboard at `http://aop.localhost:25150`. SQLite state lives at `~/.aop/projects.sqlite`. There is no hosted orchestrator, AOP account, product telemetry, or data collection.

AOP owns product state: registered repositories, worker memberships, task packages and assignments, workflow selection, worktrees, logs, runtime-event projections, and operator actions. The selected runtime CLI owns model/provider access, tool execution, conversational context, and any runtime-native subagent behavior.

## Supported runtimes

| Runtime | Provider id | Process shape |
| --- | --- | --- |
| Claude Code | `claude-code` | `claude` stream-json session |

Phase 1 exposes Claude Code only. The Codex CLI (`codex-cli`) and Pi (`pi`) adapters remain in `packages/llm-provider` but are not in the runtime catalog, provider lists or pickers until Phase 2.

Each adapter launches a detached process, ingests JSONL events, and persists a runtime session id when available. See [Runtimes](../RUNTIMES.md) for configuration and capabilities.

## Task and worker model

A worker is a named seat with role/focus metadata, runtime defaults, a default workflow, and repository memberships. Workers are created from chat (the worker card) and assigned through task cards; there is no Workers page. One worker runs at most one task at a time.

A task is assigned to at most one current writable worker. Its workflow executes in a worktree for the primary repository; supporting repositories are provided as read-only context. Execution is refused when the worker lacks a required membership.

Task lifecycle is `DRAFT`, `READY`, `RESUMING`, `WORKING`, `PAUSED`, `BLOCKED`, `DONE`, or `REMOVED`.

## Detached executor and events

The local server spawns runtime CLIs detached from the dashboard and records the process/session identity. Active steps can survive a browser close or local-server restart. JSONL output is normalized into runtime events such as session start, assistant text, tool activity, attention requests, handoffs, verification evidence, completion, failure, or interruption.

Task detail streams current logs through SSE and reads historical execution events from SQLite. Token and cost usage attach to step runs when the provider reports them.

## Storage map

| Data | Location |
| --- | --- |
| SQLite product state | `~/.aop/projects.sqlite` |
| Task package | `~/.aop/repos/<repo-id>/tasks/<slug>/` |
| Task worktree | `~/.aop/worktrees/<repo-id>/<task-id>/` |
| Live step logs | `~/.aop/logs/<step-id>.jsonl` before SQLite flush |

Repository removal resets AOP-owned repository data. Runtime authentication homes are deliberately preserved so agent logins survive a factory reset.

## Dashboard

The dashboard is Sessions-first:

- **Sessions** `/` — the rail, thread, composer, right panel, and terminal dock.
- **Settings** `/settings` — General + License, Repositories, Runtimes, Execution hosts, Workflows, About.

Task detail lives at `/tasks/:id` (deep links from chat cards). Legacy routes (`/chat`, `/pool`, `/workers`, `/metrics`, `/workflows/:id`) redirect to the home page. The rail footer shows the installed version, update action when available, and an execution host selector when applicable.

## Desktop and Windows

The desktop app is a thin client of one AOP host. It bundles the dashboard, serves it to its window as `app://aop`, and keeps the host's address and its device token (in the operating system's keychain) in its main process, handing them to the dashboard in memory over a narrow preload bridge. The main process also watches the host's event streams to raise operating system notifications. On a Mac the app can run the host itself, bound to loopback. Windows is a client only and runs no server. [The host guide](../HOST.md) covers pairing, the cross-origin rules, and host mode.

## Updates

The local update service polls release metadata from getaop.com. When a newer version is available, the dashboard top bar exposes **Update**; the server coordinates the platform-specific update path without moving orchestration into a hosted service.

## Related guides

- [Runtimes](../RUNTIMES.md)
- [MCP](../MCP.md)
