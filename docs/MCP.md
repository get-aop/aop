# AOP MCP server

The AOP MCP server gives supported runtimes typed access to the local AOP host. This guide lists the tools and summarizes loopback authentication.

Claude Code and Codex CLI are the MCP-capable runtimes. AOP passes each of their sessions an authenticated MCP endpoint. PI receives none.

## Tools

| Tool | Behavior |
| --- | --- |
| `aop_list_repos` | Returns the registered repositories |
| `aop_set_chat_workspace` | Binds the current chat to an absolute path in the same git repository |

## Loopback authentication

The MCP endpoint listens on localhost and requires a token that is valid for one chat session. The local server derives it from a secret generated at boot and adds it to the MCP URL it hands the runtime. Requests with a missing, invalid, or other-session token are rejected, including tool discovery. The trust boundary and threat model are recorded in the [MCP loopback-authentication ADR](./adr/mcp-loopback-authentication.md).

## Related guides

- [Runtimes](./RUNTIMES.md)
- [Architecture](./architecture/README.md)
