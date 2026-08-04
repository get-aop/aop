import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { hasValidMcpAccess } from "./auth.ts";
import { callAopMcpTool, listAopMcpTools, type McpToolResult } from "./tools.ts";

/** Runtimes whose CLI can host the AOP MCP server. */
export const MCP_CAPABLE_RUNTIMES = new Set(["claude-code", "codex-cli", "grok-build", "grok"]);

export const isMcpCapableRuntime = (runtime: string): boolean => MCP_CAPABLE_RUNTIMES.has(runtime);

interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

/**
 * Minimal MCP JSON-RPC over HTTP (tools/list + tools/call).
 */
export const createMcpRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();
  routes.get("/tools", (c) => {
    const unauthorized = rejectUnauthorizedMcpRequest(c);
    return unauthorized ?? c.json({ tools: listAopMcpTools() });
  });
  routes.post("/", (c) => handleMcpJsonRpc(c, ctx));
  return routes;
};

const handleMcpJsonRpc = async (c: Context, ctx: LocalServerContext) => {
  const unauthorized = rejectUnauthorizedMcpRequest(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<McpJsonRpcRequest>().catch(() => null);
  if (!body || typeof body.method !== "string") {
    return c.json(rpcError(null, -32600, "Invalid Request"), 400);
  }
  try {
    return await dispatchMcpMethod(c, ctx, body, {
      chatSessionId: c.req.query("sessionId")?.trim() || undefined,
    });
  } catch (error) {
    return handleMcpToolError(c, body, error);
  }
};

const rejectUnauthorizedMcpRequest = (c: Context): Response | null => {
  const chatSessionId = c.req.query("sessionId")?.trim();
  const accessToken = c.req.query("accessToken")?.trim();
  if (hasValidMcpAccess(chatSessionId, accessToken)) return null;
  return c.json({ error: "Unauthorized MCP request" }, 401);
};

const dispatchMcpMethod = async (
  c: Context,
  ctx: LocalServerContext,
  body: McpJsonRpcRequest,
  toolContext: { chatSessionId?: string },
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
    return c.json(
      rpcResult(body.id, {
        tools: listAopMcpTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      }),
    );
  }
  if (body.method === "tools/call") {
    const params = (body.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const result = await callAopMcpTool(
      ctx,
      String(params.name ?? ""),
      params.arguments ?? {},
      toolContext,
    );
    return c.json(rpcResult(body.id, formatToolCallResult(result)));
  }
  // JSON-RPC errors use HTTP 200 with an error object (not transport 404).
  return c.json(rpcError(body.id, -32601, `Method not found: ${body.method}`), 200);
};

const formatToolCallResult = (result: McpToolResult): unknown => ({
  content: result.content,
  isProposal: result.isProposal,
  ...(result.action ? { action: result.action } : {}),
});

const handleMcpToolError = (c: Context, body: McpJsonRpcRequest, error: unknown): Response => {
  if (error instanceof Error) {
    return c.json(rpcError(body.id, -32000, error.message), 200);
  }
  throw error;
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
