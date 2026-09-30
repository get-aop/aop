# AOP architecture

AOP is a local-first control plane layered on top of external coding-agent CLIs. This guide covers the product and runtime boundary, projects and threads, how a turn runs, local storage, and the dashboard and desktop clients. The guides beside it go deeper on single parts.

## Local-first boundary

The Bun and Hono server, called the host, serves the API and the dashboard at `http://aop.localhost:25150`. Its SQLite state lives at `~/.aop/projects.sqlite`. There is no hosted orchestrator, AOP account, product telemetry, or data collection. The dashboard, the `aop` CLI and the desktop apps are clients of one host; [Running the host](../HOST.md) covers how they authenticate.

AOP owns product state: projects and their memory, threads, chat messages and runs, registered repositories, worktrees, the event log, usage, paired devices, and operator actions. The selected runtime CLI owns model and provider access, tool execution, conversational context, and any runtime-native subagent behavior.

## Projects, coordinators and threads

A project holds a goal, instructions, attached repositories, memory files, and the models and access its sessions use. It has one coordinator: a chat session that talks to the person and starts threads. A thread is another chat session that does one piece of work in one repository, in a worktree and on a branch of its own, and lands it through one pull request.

- The coordinator is hermetic. It runs with the AOP tools only and does no work itself: it starts, steers, stops and reports on threads, opens and merges their pull requests, proposes threads, and reads and writes memory. See [MCP](../MCP.md).
- A thread reports back to the coordinator when it finishes, and asks the person when it needs a decision. A thread is `waiting-on-you`, `working`, `queued`, `rate-limited`, `ready-for-review`, `landing`, `idle` or `resolved`.
- What every session is told about its project is in [What a project session is told](./project-context.md). The worktree, the pull request and the pull request watcher are in [Threads and git](../THREADS.md). The cap on running turns and usage limits are in [Run scheduling](../SCHEDULING.md).

## Supported runtimes

| Runtime | Provider id | Process shape |
| --- | --- | --- |
| Claude Code | `claude-code` | `claude` stream-json session |

Phase 1 exposes Claude Code only. The Codex CLI (`codex-cli`) and PI (`pi`) adapters remain in `packages/llm-provider` but are not in the runtime catalog, provider lists or pickers until Phase 2. See [Runtimes](../RUNTIMES.md) for configuration.

## A turn, and how the page follows it

Every turn is one runtime process, launched detached from the server so it outlives a browser close. The adapter writes the CLI's JSONL output to a log under `~/.aop/logs/chat-sessions/<session-id>/`; the host tails it, records the reply and its tool activity on the session, and persists the runtime session id so the next turn resumes the same conversation. At startup the host looks at every run still marked running and picks each one up again, so a server restart does not lose a turn. Token and cost usage attach to a run when the CLI reports them.

Clients follow a project over `GET /api/projects/:id/stream`, a server-sent event stream with resume. Its entries are stored in the event log, so a client that drops picks up where it stopped. [Project event stream](./project-event-stream.md) describes it, [The coordinator chat](./coordinator-chat.md) how the dashboard keeps the conversation correct across reconnects, and [The thread pane](./thread-pane.md) how a thread page is built.

## Storage map

| Data | Location |
| --- | --- |
| SQLite product state | `~/.aop/projects.sqlite` |
| Thread worktree | `~/.aop/worktrees/<repo-id>/<thread-id>/` |
| Coordinator workspace | `~/.aop/projects/<project-id>/coordinator/` |
| Scratch directory of a thread with no repository | `~/.aop/projects/<project-id>/threads/<thread-id>/` |
| Run logs and attachments | `~/.aop/logs/chat-sessions/<session-id>/` |
| Workspace of a chat with no repository | `~/.aop/chats/general/` |

`AOP_HOME` moves the whole tree. Removing a repository deletes its worktrees, chat history and logs under `~/.aop/`. Runtime authentication homes (see [Runtimes](../RUNTIMES.md)) are deliberately preserved, so agent logins survive a reset.

## Dashboard

The dashboard is Projects-first. `/` lists projects as cards, and a project opens on its Overview, its threads grouped by what they need from the person. The other project screens are the Coordinator chat, a single thread, and the project's settings. Settings for the host itself open as a dialog: General, Repositories, Runtimes, Devices and About. Any other path is rewritten to `/`. [Dashboard](../../apps/dashboard/README.md) has the route table and how the page stays current.

## Desktop and Windows

The desktop app is a thin client of one AOP host. It bundles the dashboard, serves it to its window as `app://aop`, and keeps the host's address and its device token (in the operating system's keychain) in its main process, handing them to the dashboard in memory over a narrow preload bridge. The main process also watches the host's event streams to raise operating system notifications. On a Mac the app can run the host itself, bound to loopback. Windows is a client only and runs no server. [The host guide](../HOST.md) covers pairing, the cross-origin rules, and host mode.

## Related guides

- [Runtimes](../RUNTIMES.md)
- [MCP](../MCP.md)
