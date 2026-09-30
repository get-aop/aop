# AOP MCP server

The AOP MCP server gives supported runtimes typed access to the local AOP host. This guide lists the tools each kind of session gets, how results are shaped, and summarizes loopback authentication.

Claude Code and Codex CLI are the MCP-capable runtimes. AOP passes each of their sessions an authenticated MCP endpoint. PI receives none. Phase 1 runs projects on Claude Code only.

## Tools

The session behind the MCP URL decides which tools `tools/list` offers and `tools/call` accepts. A call to a tool the session is not offered fails as an unknown tool.

### Project coordinator

The coordinator is hermetic: it runs with the AOP tools only, with no Claude settings, hooks, other MCP servers, CLAUDE.md or auto memory, and its command line asks for no built-in tools. Its access mode is `approval-required`, pinned for every run whatever the stored session says, so the run carries no permission-skipping flag and only the tools below are pre-approved. All real work goes through a thread.

| Tool | Behavior |
| --- | --- |
| `thread_spawn` | Starts a thread in one of the project's repositories with a complete brief, and returns at once. A project with several repositories needs `repoId`. Attaches a live thread card to the coordinator's reply. |
| `thread_steer` | Sends a message to an existing thread of this project: queued while it works, a new turn while it is idle. Counts toward the reply's routing receipt. |
| `thread_stop` | Ends the thread's running turn and drops its queued messages. |
| `thread_list` | Lists the project's threads with status, progress and the question of any thread waiting on the person. |
| `thread_report` | Returns one thread's state and the end of its transcript. |
| `thread_open_pr` | Opens a thread's pull request: its changes are committed, its branch pushed, the pull request opened. A thread has one, so asking again pushes what the thread did since and returns the same one; a merged or closed one is refused. |
| `thread_merge_pr` | Merges a thread's pull request when the person asks. The thread is then resolved and its branch removed. Refused while the thread holds work the pull request lacks, and when GitHub will not merge it; the error says why. |
| `thread_resolve` | Marks a thread resolved: its worktree is removed, its branch kept, and a later `thread_steer` reopens it. Refused while the thread is working. |
| `propose_threads` | Attaches a "Suggested threads" block to the reply; nothing runs until the person starts one. |
| `project_settings_get` | Reads goal, instructions, models and effort, notification level, thread access, whether pull requests are fixed automatically, and repositories. |
| `project_settings_set` | Changes the thread model and effort, or the notification level. The goal and instructions (which go into every session's system prompt), thread access, automatic pull request fixes, repositories and the coordinator's own runtime stay with the person: a call that names any of them fails with an error and changes nothing, also when it names a valid setting too. |
| `memory_read`, `memory_write` | Read and write the project's memory files. |

A thread's report reaches the coordinator as a `Thread report:` message that wakes it, so it does not poll. The wake waits until the coordinator's inbox has been quiet for 2 seconds (up to 10 after the first report), and a run takes every report waiting, in order, as one turn that says how many arrived. Threads that end together, or while the coordinator is busy, are answered by one reply. A report is a stored message, so none is lost if the server stops before the coordinator reads it: boot starts what is waiting. A message from the person ends a batch and gets its own turn.

### Project thread

| Tool | Behavior |
| --- | --- |
| `aop_ask_user` | Puts the thread on "waiting on you" with a question and up to eight options (at most one recommended). The thread ends its turn; the person's reply resumes the same runtime session as the next turn. |
| `aop_report_status` | Sets the thread's checklist (`pending`, `active`, `done` steps) and its one-line status. |
| `aop_open_pr` | Opens the thread's pull request from its own branch, with the title and description the thread gives or ones written from its conversation. Called again, it pushes what the thread did since and returns the same pull request; a merged or closed one is refused. |
| `memory_read`, `memory_write` | Same project memory as the coordinator. |

Claude's own `AskUserQuestion` is withheld from threads: it cannot be answered without a terminal. So are the built-ins that schedule or wake a session (`ScheduleWakeup`, `CronCreate`, `CronDelete`, `CronList`, `Monitor`, `RemoteTrigger`): AOP decides when a thread's next turn starts, and a timer the thread armed would fire into a session AOP is not running.

A thread keeps the person's own MCP servers, settings and hooks. Claude Code defers MCP tools behind its tool search by default, so the `aop` server is passed with `alwaysLoad: true` (a per-server option of Claude Code's MCP config). Its tools are in the prompt from the first request and never need a `ToolSearch` call; other servers keep the CLI's default loading.

### Plain chat session

| Tool | Behavior |
| --- | --- |
| `aop_list_repos` | Returns the registered repositories |
| `aop_set_chat_workspace` | Binds the current chat to an absolute path in the same git repository |

Threads, their worktrees and pull requests are described in [Threads and git](./THREADS.md).

## Results

`tools/call` answers with `result.content`, an array of `{ "type": "text", "text": ... }` blocks, as the MCP specification requires. A tool that ran and refused (bad arguments, a thread that is not in this project, a paused project) sets `isError: true` and explains itself in the text, so the model can correct the call. Argument schemas are generated from the same definitions that validate them.

## Loopback authentication

The MCP endpoint listens on localhost and requires a token that is valid for one chat session. The local server derives it from a secret generated at boot and adds it to the MCP URL it hands the runtime. Requests with a missing, invalid, or other-session token are rejected, including tool discovery, and so is a correctly signed URL whose session no longer exists. The trust boundary and threat model are recorded in the [MCP loopback-authentication ADR](./adr/mcp-loopback-authentication.md).

## Related guides

- [What a project session is told](./architecture/project-context.md): the project brief, instructions and memory each session's system prompt carries
- [Runtimes](./RUNTIMES.md)
- [Architecture](./architecture/README.md)
