import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { authorizedSession } from "../mcp/routes.ts";
import type { ProjectServices } from "../project/services.ts";
import type { CuaGate, JsonRpcRequest } from "./mcp-gate.ts";

/**
 * CUA Driver's MCP server for a project's threads (`/api/mcp/cua`), behind the same per-session
 * token as the AOP tools. Only a thread's session gets through: the coordinator never has CUA.
 */
export const createCuaGateRoutes = (
  ctx: LocalServerContext,
  services: ProjectServices,
  gate: () => CuaGate,
) => {
  const routes = new Hono();

  // The gate sends no server-initiated messages outside a call's own stream.
  routes.get("/", (c) => c.body(null, 405, { Allow: "POST" }));

  routes.post("/", async (c) => {
    const session = await authorizedSession(c, ctx, services);
    if (session?.kind !== "thread" || !session.project_id) {
      return c.json({ error: "Unauthorized: computer use is for a project's threads only" }, 401);
    }
    const body = await c.req.json<JsonRpcRequest>().catch(() => null);
    if (!body || typeof body.method !== "string") {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
        400,
      );
    }
    const thread = { id: session.id, projectId: session.project_id, title: session.title };
    return gate().handle(thread, body, c.req.raw.signal);
  });

  return routes;
};
