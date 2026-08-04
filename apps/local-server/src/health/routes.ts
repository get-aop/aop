import type { FactoryHealthSnapshot } from "@aop/common";
import { Hono } from "hono";
import { getFactoryHealthSnapshot } from "./factory-health.ts";
import { getHealth, type HealthDeps } from "./handlers.ts";

export interface HealthRoutesDeps extends HealthDeps {
  getFactoryHealthSnapshot?: () => Promise<FactoryHealthSnapshot>;
}

export const createHealthRoutes = (deps: HealthRoutesDeps) => {
  const app = new Hono();

  app.get("/", async (c) => {
    return c.json(await getHealth(deps));
  });

  app.get("/details", async (c) => {
    return c.json(
      await (deps.getFactoryHealthSnapshot?.() ??
        getFactoryHealthSnapshot({
          ctx: deps.ctx,
          orchestratorStatus: deps.orchestratorStatus,
        })),
    );
  });

  return app;
};
