import { ApplyUpdateRequestSchema } from "@aop/common";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/api-auth.ts";
import type { UpdateService } from "./update-service.ts";

/**
 * What the host knows about its own release. Reading is open to every paired device, and the
 * status says whether the caller may act on it; checking, starting and cancelling an update
 * follow the `host_management` setting (see auth/route-policy.ts), because an update restarts
 * the host for everyone.
 */
export const createUpdateRoutes = (updates: UpdateService) => {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) => c.json(await updates.status(c.get("caller"))));

  routes.post("/check", async (c) => c.json(await updates.check(c.get("caller"))));

  // `{ when: "idle" }` waits for the turns running now to finish; no body means now.
  routes.post("/apply", async (c) => {
    const parsed = ApplyUpdateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'when must be "now" or "idle"' }, 400);
    const result = await updates.apply(parsed.data);
    return result.ok ? c.json(result, 202) : c.json({ error: result.error }, 409);
  });

  routes.delete("/apply", async (c) => {
    await updates.cancel();
    return c.body(null, 204);
  });

  return routes;
};
