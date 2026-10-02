# AOP MCP server

The AOP MCP server gives supported runtimes typed access to the local AOP host. This guide lists the tools each kind of session gets, how results are shaped, and summarizes loopback authentication.

Claude Code and Codex CLI are the MCP-capable runtimes. AOP passes each of their sessions an authenticated MCP endpoint. PI receives none. Phase 1 runs projects on Claude Code only.

## Tools

The session behind the MCP URL decides which tools `tools/list` offers and `tools/call` accepts. A call to a tool the session is not offered fails as an unknown tool.

### Project coordinator

The coordinator is hermetic: it runs with the AOP tools only, with no Claude settings, hooks, other MCP servers, CLAUDE.md or auto memory, and its command line asks for no built-in tools. Its access mode is `approval-required`, pinned for every run whatever the stored session says, so the run carries no permission-skipping flag and only the tools below are pre-approved. Its command line also denies the built-ins that touch the host by name (`--disallowedTools`). While the host owner's Skip permission checks setting is on, the coordinator runs with `--dangerously-skip-permissions` like every session, and its tools stay the same: `--tools ""` and the deny list hold in bypass mode ([Runtimes](./RUNTIMES.md#the-coordinator-stays-restricted)). All real work goes through a thread.

| Tool | Behavior |
| --- | --- |
| `thread_spawn` | Starts a thread in one of the project's repositories with a complete brief, and returns at once. A project with several repositories needs `repoId`. Attaches a live thread card to the coordinator's reply. |
| `thread_steer` | Sends a message to an existing thread of this project. While the thread works, the message reaches its running turn after the tool call it is on, so a correction changes the work in progress; `when: "after-turn"` holds it until that turn ends instead. While the thread is idle it starts a new turn. Counts toward the reply's routing receipt. |
| `thread_stop` | Ends the thread's running turn and drops its queued messages. |
| `thread_list` | Lists the project's threads with status, progress and the question of any thread waiting on the person. |
| `thread_report` | Returns one thread's state and the end of its transcript. |
| `thread_open_pr` | Opens a thread's pull request: its changes are committed, its branch pushed, the pull request opened. A thread has one, so asking again pushes what the thread did since and returns the same one; a merged or closed one is refused. |
| `thread_merge_pr` | Merges a thread's pull request when the person asks. The thread is then resolved and its branch removed. Refused while the thread holds work the pull request lacks, and when GitHub will not merge it; the error says why. |
| `thread_resolve` | Marks a thread resolved: its worktree is removed, its branch kept, and a later `thread_steer` reopens it. Refused while the thread is working. |
| `propose_threads` | Attaches a "Suggested threads" block to the reply: each thread's title, brief, repository and a one-line `reason` (at most 140 characters) the person reads. Nothing runs until the person starts one. |
| `project_settings_get` | Reads goal, instructions, models and effort, notification level, thread access, whether pull requests are fixed automatically, and repositories. |
| `project_settings_set` | Changes the thread model and effort, or the notification level. The goal and instructions (which go into every session's system prompt), thread access, automatic pull request fixes, repositories and the coordinator's own runtime stay with the person: a call that names any of them fails with an error and changes nothing, also when it names a valid setting too. |
| `memory_read`, `memory_write` | Read and write the project's memory files. |
| `memory_delete` | Deletes a topic file from the project's memory. `MEMORY.md`, the index, cannot be deleted; it is rewritten with `memory_write`. Threads do not hold this tool. |
| `aop_artifact_create`, `aop_artifact_update` | Make an artifact (a document for the person, kept in the project's Library) or save a new version of one, from `content` or a workspace `path`. The chat shows a card where the call was made, which opens the artifact view. See [Artifacts](./ARTIFACTS.md). |

A thread's report reaches the coordinator as a `Thread report:` message that wakes it, so it does not poll. The wake waits until the coordinator's inbox has been quiet for 2 seconds (up to 10 after the first report), and a run takes every report waiting, in order, as one turn that says how many arrived. Threads that end together, or while the coordinator is busy, are answered by one reply. A report is a stored message, so none is lost if the server stops before the coordinator reads it: boot starts what is waiting. A message from the person ends a batch and gets its own turn.

### Project thread

| Tool | Behavior |
| --- | --- |
| `aop_ask_user` | Puts the thread on "waiting on you" with a question and up to eight options (at most one recommended). The thread ends its turn; the person's reply resumes the same runtime session as the next turn. |
| `aop_report_status` | Sets the thread's checklist (`pending`, `active`, `done` steps) and its one-line status. With `waitingOn` (`reason`, optional `https` `link`) the thread says it waits on the person for something outside AOP, such as a deployment to approve on GitHub, a login or a secret, while its turn goes on: it shows under Waiting on you with the reason and link, and the coordinator gets a `needs-you` report at once. The same wait reported again tells nobody again. The wait clears when the thread reports without `waitingOn` or its turn ends. |
| `aop_open_pr` | Opens the thread's pull request from its own branch, with the title and description the thread gives or ones written from its conversation. Called again, it pushes what the thread did since and returns the same pull request; a merged or closed one is refused. |
| `memory_read`, `memory_write` | Same project memory as the coordinator (no `memory_delete`). |
| `aop_artifact_create`, `aop_artifact_update` | Same artifacts as the coordinator; a card in the thread's chat opens the artifact view in the coordinator's place, beside the thread. |

Claude's own `AskUserQuestion` is withheld from threads: it cannot be answered without a terminal. So are the built-ins that schedule or wake a session (`ScheduleWakeup`, `CronCreate`, `CronDelete`, `CronList`, `Monitor`, `RemoteTrigger`): AOP decides when a thread's next turn starts, and a timer the thread armed would fire into a session AOP is not running.

A thread keeps the person's own MCP servers, settings and hooks. A thread of a project whose computer use is CUA also gets CUA Driver's server, `cua-driver`, when the driver can serve; see [Threads and git](./THREADS.md#computer-and-browser-use). The coordinator never does. Claude Code defers MCP tools behind its tool search by default, so the `aop` server is passed with `alwaysLoad: true` (a per-server option of Claude Code's MCP config). Its tools are in the prompt from the first request and never need a `ToolSearch` call; other servers keep the CLI's default loading.

### Plain chat session

| Tool | Behavior |
| --- | --- |
| `aop_list_repos` | Returns the registered repositories |
| `aop_set_chat_workspace` | Binds the current chat to an absolute path in the same git repository |

Threads, their worktrees and pull requests are described in [Threads and git](./THREADS.md).

## Results

`tools/call` answers with `result.content`, an array of `{ "type": "text", "text": ... }` blocks, as the MCP specification requires. A tool that ran and refused (bad arguments, a thread that is not in this project, a paused project) sets `isError: true` and explains itself in the text, so the model can correct the call. Argument schemas are generated from the same definitions that validate them.

## Loopback authentication

The MCP endpoint listens on localhost and requires a token that is valid for one chat session. The local server derives it from a secret kept in `~/.aop/mcp-secret` (the AOP home; owner-only, mode 600, created on first use) and adds it to the MCP URL it hands the runtime. Because the secret outlives the host process, a run that survives a host restart or upgrade keeps calling its tools: Claude Code's HTTP client sends its next request to the new process, which accepts the same token. Requests with a missing, invalid, or other-session token are rejected, including tool discovery, and so are a correctly signed URL whose session no longer exists and one of a resolved thread. The trust boundary and threat model are recorded in the [MCP loopback-authentication ADR](./adr/mcp-loopback-authentication.md).

- **Rotation.** `POST /api/mcp-secret/rotate` (host owner only) writes a new secret. Every token issued before stops working at once, on purpose; each run's next turn gets a new one. Deleting the file and restarting the host does the same.
- **When the file cannot be kept.** If the AOP home cannot be written or the file read (or a loosened file cannot be made owner-only again), the host logs a warning and signs with a secret of its own process, as it did before the secret was kept: tokens then stop working when the host restarts.
- **What a refused client sees.** A refusal is a `401` with a JSON body. Claude Code then looks for OAuth metadata under `/.well-known/` and tries `POST /register`; the host answers those with a JSON `404`, not the dashboard page, so the client reports a refusal instead of a `SyntaxError`. `GET /api/mcp`, which a streamable-HTTP client uses to open a stream for server messages, answers `405`: the host sends none.

## Threads whose tools stop working

The host marks a working thread degraded, shows it in the threads panel and tells the coordinator with a `needs-you` report, when either happens:

- the thread's transcript shows a call to one of its AOP tools that failed and never reached the host (Claude Code names each call with `_meta["claudecode/toolUseId"]`, which the host records), or
- the host refuses a request carrying the session's id and a token of the shape it signs (the secret was rotated under the turn).

A call that is still running never counts, however long it takes, and neither does a failed call of another tool or an AOP call that reached the host and failed there. The mark clears when a request from the session is accepted again and when the turn ends; the next turn runs with tools of its own.

## Related guides

- [What a project session is told](./architecture/project-context.md): the project brief, instructions and memory each session's system prompt carries
- [Runtimes](./RUNTIMES.md)
- [Architecture](./architecture/README.md)
