import { Hono } from "hono";
import type { AuthEnv } from "../auth/api-auth.ts";
import type { HostSetupService } from "./service.ts";

/**
 * The host's setup checklist (AOP settings › Host). Any device reads it; `?fresh=1` looks again
 * instead of reusing the last few seconds' looks. Running a fix is for whoever may manage the
 * host (auth/route-policy.ts).
 */
export const createHostSetupRoutes = (service: HostSetupService) => {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) =>
    c.json(await service.setup({ fresh: c.req.query("fresh") === "1" })),
  );

  routes.post("/:id/fix", async (c) => {
    const result = await service.fix(c.req.param("id"));
    if (result.ok) return c.json(result.setup);
    if (result.code === "FIX_FAILED") {
      return c.json({ error: result.error, code: result.code, setup: result.setup }, 500);
    }
    return c.json(
      { error: result.error, code: result.code },
      result.code === "NOT_FOUND" ? 404 : 409,
    );
  });

  return routes;
};
