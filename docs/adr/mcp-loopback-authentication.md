# ADR: Authenticate the local MCP protocol endpoint

- Status: **Accepted** (2026-07-15)
- Phase 1 note: Grok support was removed and only Claude Code is exposed; the `codex-cli`
  adapter stays in the tree unexposed until Phase 2.
- Context: A local process can otherwise send MCP JSON-RPC directly to AOP and invoke tools
  without being launched as an MCP client by AOP.

## Decision

AOP authenticates its machine-facing MCP protocol surfaces with an unguessable per-boot secret.
For each MCP-capable chat session, the local server derives a session-bound HMAC token and adds
both `sessionId` and `accessToken` to the MCP URL passed to `claude-code`.

`POST /api/mcp` and `GET /api/mcp/tools` reject requests whose token is missing, invalid, or
bound to another session. This gates every MCP method, including discovery and read-only tools,
instead of maintaining a security-sensitive list of write tools.

When this was decided, `POST /api/mcp/confirm/task-assignment` was a third route under `/api/mcp`:
a dashboard callback that applied a proposal after the user confirmed it, and so not an MCP protocol
surface. Task assignment and that route have since been removed. `POST /api/mcp` and
`GET /api/mcp/tools` are the only routes under `/api/mcp`; both require the MCP token, and no
browser credential reaches them.

## Caller inventory

- `apps/local-server/src/chat-session/run-options.ts` issues authenticated MCP URLs only for
  the `claude-code` runtime.
- `packages/llm-provider/src/providers/claude-code.ts` passes the URL through Claude's HTTP MCP
  configuration.
- `packages/llm-provider/src/providers/codex-cli.ts` passes the URL through Codex's
  `mcp_servers.aop.url` configuration.
- No dashboard code calls `/api/mcp`.
- HTTP route tests exercise the protocol directly; tool unit tests call the tool layer without
  crossing the HTTP boundary.

## Consequences

- A bare local `curl` can no longer discover or invoke AOP MCP tools.
- Tokens are valid only for one chat session and the lifetime of the local-server process.
- The token is carried in the provider-owned MCP URL, so it must be treated as a credential and
  must not be copied into logs or user-visible error messages.
- Non-MCP providers remain unsupported and receive no endpoint or credential.
