import { Hono } from "hono";
import type { UpdateService } from "./update-service.ts";

/**
 * What the host knows about its own release. Reading and checking are open to every paired
 * device, which is why a remote dashboard shows the notice; starting the update is the host
 * owner's alone (see auth/route-policy.ts), because it restarts the machine's service.
 */
export const createUpdateRoutes = (updates: UpdateService) => {
  const routes = new Hono();

  routes.get("/", async (c) => c.json(await updates.status()));

  routes.post("/check", async (c) => c.json(await updates.check()));

  routes.post("/apply", async (c) => {
    const result = await updates.apply();
    return result.ok ? c.json({ ok: true }, 202) : c.json({ error: result.error }, 409);
  });

  return routes;
};
