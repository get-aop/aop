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
| `propose_threads` | Attaches a "Suggested threads" block to the reply; nothing runs until the person starts one. |
| `project_settings_get` | Reads goal, instructions, models and effort, notification level, thread access and repositories. |
| `project_settings_set` | Changes the thread model and effort, or the notification level. The goal and instructions (which go into every session's system prompt), thread access, repositories and the coordinator's own runtime stay with the person: a call that names any of them fails with an error and changes nothing, also when it names a valid setting too. |
| `memory_read`, `memory_write` | Read and write the project's memory files. |

A thread's report reaches the coordinator as a `Thread report:` message that wakes it, so it does not poll.

### Project thread

| Tool | Behavior |
| --- | --- |
| `aop_ask_user` | Puts the thread on "waiting on you" with a question and up to eight options (at most one recommended). The thread ends its turn; the person's reply resumes the same runtime session as the next turn. |
| `aop_report_status` | Sets the thread's checklist (`pending`, `active`, `done` steps) and its one-line status. |
| `memory_read`, `memory_write` | Same project memory as the coordinator. |

Claude's own `AskUserQuestion` is withheld from threads: it cannot be answered without a terminal.

### Plain chat session

| Tool | Behavior |
| --- | --- |
| `aop_list_repos` | Returns the registered repositories |
| `aop_set_chat_workspace` | Binds the current chat to an absolute path in the same git repository |

## Results

`tools/call` answers with `result.content`, an array of `{ "type": "text", "text": ... }` blocks, as the MCP specification requires. A tool that ran and refused (bad arguments, a thread that is not in this project, a paused project) sets `isError: true` and explains itself in the text, so the model can correct the call. Argument schemas are generated from the same definitions that validate them.

## Loopback authentication

The MCP endpoint listens on localhost and requires a token that is valid for one chat session. The local server derives it from a secret generated at boot and adds it to the MCP URL it hands the runtime. Requests with a missing, invalid, or other-session token are rejected, including tool discovery, and so is a correctly signed URL whose session no longer exists. The trust boundary and threat model are recorded in the [MCP loopback-authentication ADR](./adr/mcp-loopback-authentication.md).

## Related guides

- [What a project session is told](./architecture/project-context.md): the project brief, instructions and memory each session's system prompt carries
- [Runtimes](./RUNTIMES.md)
- [Architecture](./architecture/README.md)
