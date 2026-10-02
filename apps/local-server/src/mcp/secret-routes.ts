import { Hono } from "hono";
import { rotateMcpSecret } from "./auth.ts";

/**
 * The host owner's control over the MCP secret (owner-only, see auth/route-policy.ts). Rotating
 * it invalidates the token of every run in flight: their AOP tools stop working, and the host
 * marks each working thread degraded when it next calls them. Their next turn gets a new token.
 */
export const createMcpSecretRoutes = () => {
  const routes = new Hono();

  routes.post("/rotate", (c) => {
    try {
      rotateMcpSecret();
      return c.json({ rotated: true });
    } catch (error) {
      return c.json({ error: `Could not rotate the MCP secret: ${String(error)}` }, 500);
    }
  });

  return routes;
};
