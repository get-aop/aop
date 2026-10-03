import { Hono } from "hono";
import type { AgentCliService } from "./service.ts";

/**
 * The agent CLIs on the host. Any paired device may read, so a remote dashboard shows the badge;
 * checking and updating follow the `host_management` setting (see auth/route-policy.ts), because
 * an update installs software on the machine.
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
