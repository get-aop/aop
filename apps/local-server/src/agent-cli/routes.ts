import { Hono } from "hono";
import type { AgentCliService } from "./service.ts";

/**
 * The agent CLIs on the host. Any paired device may read and check, so a remote dashboard shows
 * the badge; running an update is the host owner's alone (see auth/route-policy.ts), because it
 * installs software on the machine.
 */
export const createAgentCliRoutes = (clis: AgentCliService) => {
  const routes = new Hono();

  routes.get("/", async (c) => c.json(await clis.status()));

  routes.post("/check", async (c) => c.json(await clis.check()));

  routes.post("/:provider/update", async (c) => {
    const result = await clis.update(c.req.param("provider"));
    if (result.ok) return c.json({ ok: true }, 202);
    return c.json({ error: result.error, manualCommand: result.manualCommand }, result.status);
  });

  return routes;
};
