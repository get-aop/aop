# AOP architecture

AOP is a local-first control plane layered on top of external coding-agent CLIs. This guide covers the product and runtime boundary, projects and threads, how a turn runs, local storage, and the dashboard and desktop clients. The guides beside it go deeper on single parts.

## Local-first boundary

The Bun and Hono server, called the host, serves the API and the dashboard at `http://aop.localhost:25150`. Its SQLite state lives at `~/.aop/projects.sqlite`. There is no hosted orchestrator, AOP account, product telemetry, or data collection. The dashboard, the `aop` CLI and the desktop apps are clients of one host; [Running the host](../HOST.md) covers how they authenticate.

AOP owns product state: projects and their memory, threads, chat messages and runs, registered repositories, worktrees, the event log, usage, paired devices, and operator actions. The selected runtime CLI owns model and provider access, tool execution, conversational context, and any runtime-native subagent behavior.

## Projects, coordinators and threads

A project holds a goal, instructions, attached repositories, memory files, and the models and access its sessions use. It has one coordinator: a chat session that talks to the person and starts threads. A thread is another chat session that does one piece of work in one repository, in a worktree and on a branch of its own, and lands it through one pull request.

- The coordinator is hermetic. It runs with the AOP tools only and does no work itself: it starts, steers, stops and reports on threads, opens and merges their pull requests, proposes threads, and reads and writes memory. See [MCP](../MCP.md).
- A thread reports back to the coordinator when it finishes, and asks the person when it needs a decision. A thread is `waiting-on-you`, `working`, `queued`, `rate-limited`, `ready-for-review`, `landing`, `idle` or `resolved`.
- What every session is told about its project is in [What a project session is told](./project-context.md). The worktree, the pull request and the pull request watcher are in [Threads and git](../THREADS.md). The cap on running turns and usage limits are in [Run scheduling](../SCHEDULING.md), and work on a schedule in [Routines](../ROUTINES.md).

## Supported runtimes

| Runtime | Provider id | Process shape |
| --- | --- | --- |
| Claude Code | `claude-code` | `claude` stream-json session |

Phase 1 exposes Claude Code only. The Codex CLI (`codex-cli`) and PI (`pi`) adapters remain in `packages/llm-provider` but are not in the runtime catalog, provider lists or pickers until Phase 2. See [Runtimes](../RUNTIMES.md) for configuration.

## A turn, and how the page follows it

Every turn is one runtime process, launched detached from the server so it outlives a browser close. The adapter writes the CLI's JSONL output to a log under `~/.aop/logs/chat-sessions/<session-id>/`; the host tails it (text and reasoning arrive token by token: Claude Code runs with `--include-partial-messages`), streams the turn's parts to clients as they grow, records the reply as those parts on the session, and persists the runtime session id so the next turn resumes the same conversation. At startup the host looks at every run still marked running and picks each one up again, so a server restart does not lose a turn. Token and cost usage attach to a run when the CLI reports them. The Claude plan's 5-hour and 7-day usage comes from the same tail: each `rate_limit_event` Claude Code writes updates one host-wide snapshot (kept in `~/.aop/plan-usage.json` across restarts), which `GET /api/usage/plan` serves to the usage meter in the project top bar. Reading it costs no request and no token; an API-key login writes no such event, and the meter stays hidden.

### Messages sent while a turn runs

A message to a session whose Claude Code turn is running goes into that turn instead of waiting for it to end, so "use arm64" or "stop, wrong approach" reaches the agent before it has finished the work it corrects. This applies to what the person sends to a working thread or the coordinator, and to the coordinator's `thread_steer`. The code is in `packages/llm-provider/src/providers/claude-code-input-channel.ts` and `apps/local-server/src/chat-session/run-input.ts`.

- **How it reaches the CLI.** Every chat turn gives Claude Code its prompt as a stream-json user message on stdin (`--input-format stream-json --replay-user-messages`), through a named pipe (FIFO) next to the run's log, `chat_runs.input_path`. The host opens it, writes one line and closes it, so it can write again after a restart. Claude Code never sees end of input on a FIFO, so a small `sh` relay sits in front of the CLI: it holds the FIFO open for writing (writers come and go without ending the input), copies it into a real pipe with `cat`, and lets go on SIGUSR1. The relay is the process the run records: its exit status is the CLI's, and a stop signals its process group.
- **Where the agent takes it.** Claude Code 2.1.287 hands the model a message that arrives while it works after the tool call in flight, and echoes it as a `user` line with `isReplay: true` and the `uuid` it was sent with, which is the message's id as a UUID. The turn's parts get a `steer` part there, and the reply draws the message at that point. A message that arrives while the answer is being written gets another turn of the same process once that answer ends (a second `result`, `result_index` 1): the reply goes on, and the run's usage counts that process's last result. The CLI's echoes of messages it adds itself (a background command's notification, which carry an `origin`) are not steers.
- **How it ends.** Once every message written into the run was taken and a result came after the last one, the host ends the run's input: the CLI exits after that answer. A message is never written to a run whose input is ending, and writing and ending go one at a time per run. After a restart the recovering host does the same from the log, and a relay whose host never comes back ends the input itself after half an hour of a still log. Ending the input never cuts a turn short.
- **When it cannot.** A message written into a run belongs to it (`chat_messages.steered_run_id`; on the wire, `steers` names the reply). One the run never took goes back in line when the run ends and gets a turn of its own; a stopped turn drops it, as it drops its queue. Messages that cannot be written (another runtime, Windows, a run that is ending or gone, a thread still waiting for a run slot) and messages sent with `midRunMode: "queue"` wait for the turn to end, as before; thread reports always do, so the coordinator answers them together.

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
| A project's Linear API key (owner-only file) | `~/.aop/connections/linear/<project-id>.json` |

`AOP_HOME` moves the whole tree. Removing a repository deletes its worktrees, chat history and logs under `~/.aop/`. Runtime authentication homes (see [Runtimes](../RUNTIMES.md)) are deliberately preserved, so agent logins survive a reset.

## Dashboard

The dashboard is Projects-first. `/` lists projects as cards, and a project opens on its Overview, its threads grouped by what they need from the person. The other project screens are the Coordinator chat, a single thread, and the project's settings. There is no sidebar: each screen has one top bar whose project switcher (the chip with the project's name, or ⌘K) lists every project with what waits in it, and holds New project, All projects and the AOP settings (⌘,); a + beside it starts a project. Settings for the host itself open as a dialog: General, Repositories, Runtimes, Devices and About. Any other path is rewritten to `/`. [Dashboard](../../apps/dashboard/README.md) has the route table and how the page stays current.

## Desktop and Windows

The desktop app is a thin client of one AOP host. It bundles the dashboard, serves it to its window as `app://aop`, and keeps the host's address and its device token (in the operating system's keychain) in its main process, handing them to the dashboard in memory over a narrow preload bridge. The main process also watches the host's event streams to raise operating system notifications. On a Mac the app can run the host itself, bound to loopback. Windows is a client only and runs no server. Its Mac app menu has AOP › Settings… (⌘,), which opens the AOP settings in the dashboard. The window keeps the native title bar, so the dashboard's top bar needs no traffic-light inset or drag region. [The host guide](../HOST.md) covers pairing, the cross-origin rules, and host mode.

The desktop app also has the AOP Browser: a Chromium browser shown in the coordinator chat's place (the globe in a project's top bar, or ⌘⇧B), with tabs remembered per project. Each page is a `<webview>` of the dashboard on its own persistent session, `persist:aop-browser`, so its cookies are apart from the dashboard's and survive a restart. The main process pins every page sandboxed and context-isolated with no preload, so a page cannot reach the app's bridge; refuses navigations to files, the app's own pages and Chromium's internals; asks the person before a page uses the camera, microphone, location or notifications, or opens another app; and saves downloads straight into the Downloads folder. Right-clicking a link anywhere in the app offers "Open in AOP Browser", which is how a thread's localhost link reaches it; a plain click still opens the system browser. A dashboard opened in a plain browser on a paired device has no AOP Browser: a web page cannot embed arbitrary sites, and `localhost` there would be that device, not the host.

## Related guides

- [The Issues tab](./issues-tab.md)
- [The live view of the host's screen](./live-view.md)
- [Runtimes](../RUNTIMES.md)
- [MCP](../MCP.md)
