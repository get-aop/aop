# ADR: Authenticate the local MCP protocol endpoint

- Status: **Accepted** (2026-07-15), amended 2026-10-01: the secret is kept on disk so tokens
  survive host restarts (see [Amendment](#amendment-2026-10-01-tokens-survive-host-restarts)).
- Phase 1 note: Grok support was removed and only Claude Code is exposed; the `codex-cli`
  adapter stays in the tree unexposed until Phase 2.
- Context: A local process can otherwise send MCP JSON-RPC directly to AOP and invoke tools
  without being launched as an MCP client by AOP.

## Decision

AOP authenticates its machine-facing MCP protocol surfaces with an unguessable secret (per boot when
this was decided; kept on disk since the amendment below).
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
- Tokens are valid only for one chat session; since the amendment they outlive the local-server
  process, until the secret is rotated.
- The token is carried in the provider-owned MCP URL, so it must be treated as a credential and
  must not be copied into logs or user-visible error messages.
- Non-MCP providers remain unsupported and receive no endpoint or credential.

## Amendment (2026-10-01): tokens survive host restarts

A per-boot secret made every host restart (an upgrade, a launchd reload) revoke the token of every
run that outlived it. Runs are detached and keep going, so a thread lost its AOP tools for the rest
of its turn: it could not ask the person, report its status or open its pull request, and nobody
saw it. Claude Code's MCP client retries each request on its own and reconnects to a restarted
server; it was the new process refusing the old token that kept it disconnected.

- The secret is kept in `~/.aop/mcp-secret`, mode 600, created on first use. A token stays valid
  across restarts. A file that cannot be kept falls back to a per-process secret, as before.
- Revocation does not rely on the secret changing. Every request is checked against the session:
  a deleted session and a resolved thread are refused. A stopped turn's process is ended by the stop;
  its next turn is issued the same session-scoped token.
- Rotation is explicit: `POST /api/mcp-secret/rotate` (host owner only) replaces the secret and
  invalidates every token issued before.
- A refused request for a working thread's session marks the thread degraded and tells the
  coordinator, so a lost connection is never silent.

