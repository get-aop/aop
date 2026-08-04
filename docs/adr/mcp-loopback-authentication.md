# ADR: Authenticate the local MCP protocol endpoint

- Status: **Accepted** (2026-07-15)
- Context: A local process can otherwise send MCP JSON-RPC directly to AOP and invoke tools
  without being launched as an MCP client by AOP.

## Decision

AOP authenticates its machine-facing MCP protocol surfaces with an unguessable per-boot secret.
For each MCP-capable chat session, the local server derives a session-bound HMAC token and adds
both `sessionId` and `accessToken` to the MCP URL passed to `claude-code`, `codex-cli`, or `grok-build`.

`POST /api/mcp` and `GET /api/mcp/tools` reject requests whose token is missing, invalid, or
bound to another session. This gates every MCP method, including discovery and read-only tools,
instead of maintaining a security-sensitive list of write tools.

`POST /api/mcp/confirm/task-assignment` is not an MCP protocol surface. It is a dashboard callback
that applies a proposal after explicit user confirmation and domain re-validation. It remains
protected by the local API's loopback host and browser origin guard; requiring an MCP token there
would expose that machine credential to the dashboard and couple user confirmation to a provider
session.

## Caller inventory

- `apps/local-server/src/chat-session/runtime-engine.ts` issues authenticated MCP URLs only for
  the `claude-code`, `codex-cli`, and `grok-build` (alias `grok`) runtimes.
- `packages/llm-provider/src/providers/claude-code.ts` passes the URL through Claude's HTTP MCP
  configuration.
- `packages/llm-provider/src/providers/codex-cli.ts` passes the URL through Codex's
  `mcp_servers.aop.url` configuration.
- `packages/llm-provider/src/providers/grok-build.ts` passes the URL through `AOP_MCP_SERVER_URL`
  for Grok's `mcp_servers.aop.url = "${AOP_MCP_SERVER_URL}"` config expansion.
- `apps/dashboard/src/api/client.ts` calls only the separate task-assignment confirmation route.
- HTTP route tests exercise the protocol directly; tool unit tests call the tool layer without
  crossing the HTTP boundary.

## Consequences

- A bare local `curl` can no longer discover or invoke AOP MCP tools.
- Tokens are valid only for one chat session and the lifetime of the local-server process.
- The token is carried in the provider-owned MCP URL, so it must be treated as a credential and
  must not be copied into logs or user-visible error messages.
- Non-MCP providers remain unsupported and receive no endpoint or credential.
