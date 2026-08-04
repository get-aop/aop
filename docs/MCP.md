# AOP MCP server

The AOP MCP server gives supported interactive runtimes typed access to the local control plane. This guide lists every public tool, explains the proposal-card confirmation model, and summarizes loopback authentication.

Claude Code, Codex CLI, and Grok (`grok-build`) are the MCP-capable AOP runtimes. Other agent CLIs can still use Sessions and deterministic slash commands, but platform-aware natural-language actions require one of these runtimes.

For Grok, AOP injects a session-authenticated MCP URL into `AOP_MCP_SERVER_URL`. Configure Grok once with:

```toml
# ~/.grok/config.toml
[mcp_servers.aop]
url = "${AOP_MCP_SERVER_URL}"
enabled = true
```

## Read tools

| Tool | Returns |
| --- | --- |
| `aop_status` | Readiness, capacity, and repository summary |
| `aop_list_workers` | Active worker profiles and memberships |
| `aop_list_workflows` | Available workflow ids |
| `aop_list_repos` | Registered repositories |
| `aop_list_tasks` | Tasks, optionally filtered by repository |
| `aop_get_task` | One task by id |
| `aop_list_pending_approvals` | Review-inbox handoffs awaiting confirmation |
| `aop_get_task_methodology` | Canonical rendered methodology for `task.md`, `prd.md`, and `issues.md` generation |

## Mutation tools

| Tool | Behavior |
| --- | --- |
| `aop_create_task` | Creates a complete task package after methodology generation; an optional worker only prefills assignment |
| `aop_assign_tasks` | Presents selected tasks in an Assign / Assign and Start card |
| `aop_start_task` | Immediately starts one already assigned To-do task |
| `aop_set_chat_workspace` | Binds the current chat to an absolute path in the same git repository |

Task creation must call `aop_get_task_methodology` first and pass complete PRD and issue bodies to `aop_create_task`.

## Proposal tools

| Tool | Card |
| --- | --- |
| `aop_propose_workflow` | Workflow preview for saving or running |
| `aop_propose_worker` | Worker profile proposal |
| `aop_propose_approval` | Pending handoff review card |

Proposal tools are read-only previews. The operation fires only when you click the card's confirmation action, and AOP revalidates current state at that boundary. Task assignment follows the same visible-card pattern through `aop_assign_tasks`.

## Loopback authentication

The MCP endpoint is localhost-only and requires a per-boot bearer token minted by the local server. AOP injects that token into supported runtime configuration for the current boot; stale or missing credentials are rejected. The trust boundary and threat model are recorded in the MCP loopback-authentication ADR inside the repository.

## Related guides

- [Chat](./CHAT.md)
- [Commands](./COMMANDS.md)
- [Tasks](./TASKS.md)
- [Runtimes](./RUNTIMES.md)
- [Architecture](./architecture/README.md)
