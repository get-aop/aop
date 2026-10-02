import { getLogger } from "@aop/infra";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { ProjectServices } from "../project/services.ts";
import { hasValidMcpAccess } from "./auth.ts";
import { sessionRole } from "./availability.ts";
import { McpToolError } from "./registry.ts";
import { callMcpTool, isMcpToolAvailable, listMcpTools } from "./tools.ts";

interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

const logger = getLogger("mcp");

const ToolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

// Claude Code names the call a request answers, so the host can tell which calls reached it.
const ToolUseIdSchema = z.object({
  _meta: z.object({ "claudecode/toolUseId": z.string().min(1) }),
});

// The shape of a token the host signs (an HMAC-SHA256 in base64url). A refused request carrying
// one is a run whose token went stale; anything else is not worth a thread's alarm.
const SIGNED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const UNAUTHORIZED = {
  error:
    "Unauthorized MCP request: the token does not match this host's MCP secret, or the session can no longer use AOP tools",
};

/**
 * Minimal MCP JSON-RPC over HTTP (initialize, tools/list, tools/call). The URL's signed token
 * names the chat session, and the session decides which tools are offered: a project's
 * coordinator, one of its threads, or a plain chat.
 */
export const createMcpRoutes = (ctx: LocalServerContext, services: ProjectServices) => {
  const routes = new Hono();

  routes.get("/tools", async (c) => {
    const session = await authorizedSession(c, ctx, services);
    return session
      ? c.json({ tools: listMcpTools(sessionRole(session)) })
      : c.json(UNAUTHORIZED, 401);
  });

  // Streamable HTTP clients open a stream for server-initiated messages with a GET; the host sends
  // none, and 405 is how the protocol says so.
  routes.get("/", (c) => c.body(null, 405, { Allow: "POST" }));

  routes.post("/", async (c) => {
    const session = await authorizedSession(c, ctx, services);
    if (!session) return c.json(UNAUTHORIZED, 401);
    const body = await c.req.json<McpJsonRpcRequest>().catch(() => null);
    if (!body || typeof body.method !== "string") {
      return c.json(rpcError(null, -32600, "Invalid Request"), 400);
    }
    await noteAccepted(services, session, body);
    try {
      return await dispatchMcpMethod(c, body, { ctx, services, session });
    } catch (error) {
      if (error instanceof Error) return c.json(rpcError(body.id, -32000, error.message), 200);
      throw error;
    }
  });

  return routes;
};

/**
 * The chat session behind a valid, signed MCP URL, while it may use its tools; null for anything
 * else. The token outlives host restarts (see auth.ts), so what a session may still do is decided
 * here, on every request: a deleted session and a resolved thread have no turn to serve.
 */
const authorizedSession = async (
  c: Context,
  ctx: LocalServerContext,
  services: ProjectServices,
): Promise<ChatSession | null> => {
  const sessionId = c.req.query("sessionId")?.trim();
  const accessToken = c.req.query("accessToken")?.trim();
  if (!sessionId) return null;
  if (!hasValidMcpAccess(sessionId, accessToken)) {
    if (accessToken && SIGNED_TOKEN_PATTERN.test(accessToken)) {
      await services.toolHealth.authFailed(sessionId).catch(logHealthError);
    }
    return null;
  }
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session || (session.kind === "thread" && session.state === "resolved")) return null;
  return session;
};

// Health bookkeeping never fails the request it rides on.
const noteAccepted = async (
  services: ProjectServices,
  session: ChatSession,
  body: McpJsonRpcRequest,
): Promise<void> => {
  const toolCall =
    body.method === "tools/call" ? { toolUseId: toolUseIdOf(body.params) } : undefined;
  await services.toolHealth.accepted(session, toolCall).catch(logHealthError);
};

const toolUseIdOf = (params: unknown): string | null => {
  const parsed = ToolUseIdSchema.safeParse(params);
  return parsed.success ? parsed.data._meta["claudecode/toolUseId"] : null;
};

const logHealthError = (error: unknown): void => {
  logger.warn("Could not record the AOP tool health of a session: {error}", {
    error: String(error),
  });
};

const dispatchMcpMethod = async (
  c: Context,
  body: McpJsonRpcRequest,
  call: { ctx: LocalServerContext; services: ProjectServices; session: ChatSession },
) => {
  if (body.method === "initialize") {
    return c.json(
      rpcResult(body.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "aop", version: "1.0.0" },
      }),
    );
  }
  if (body.method === "notifications/initialized") {
    // MCP streamable HTTP uses 202 Accepted for notifications.
    return c.body(null, 202);
  }
  if (body.method === "tools/list") {
    return c.json(rpcResult(body.id, { tools: listMcpTools(sessionRole(call.session)) }));
  }
  if (body.method === "tools/call") return callTool(c, body, call);
  // JSON-RPC errors use HTTP 200 with an error object (not transport 404).
  return c.json(rpcError(body.id, -32601, `Method not found: ${body.method}`), 200);
};

const callTool = async (
  c: Context,
  body: McpJsonRpcRequest,
  call: { ctx: LocalServerContext; services: ProjectServices; session: ChatSession },
) => {
  const params = ToolCallParamsSchema.safeParse(body.params);
  if (!params.success) return c.json(rpcError(body.id, -32602, "Invalid params"), 200);
  const role = sessionRole(call.session);
  if (!isMcpToolAvailable(role, params.data.name)) {
    return c.json(rpcError(body.id, -32602, `Unknown tool: ${params.data.name}`), 200);
  }
  try {
    const result = await callMcpTool(role, params.data.name, params.data.arguments, call);
    return c.json(rpcResult(body.id, result));
  } catch (error) {
    // A refused call is a tool result the model can read and act on, not a protocol failure.
    if (error instanceof McpToolError) {
      return c.json(
        rpcResult(body.id, { content: [{ type: "text", text: error.message }], isError: true }),
      );
    }
    throw error;
  }
};

const rpcResult = (id: unknown, result: unknown): unknown => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const rpcError = (id: unknown, code: number, message: string, data?: unknown): unknown => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data ? { data } : {}) },
});
