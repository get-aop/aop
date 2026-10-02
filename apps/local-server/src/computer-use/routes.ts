import { Hono } from "hono";
import type { ComputerUseService } from "./service.ts";

/**
 * Whether CUA Driver can serve threads on this host. Any paired device may read it, so a remote
 * dashboard explains the CUA option; choosing it is the host owner's alone (project routes).
 * `?fresh=1` probes again instead of reusing the last few seconds' answer.
 */
export const createComputerUseRoutes = (service: ComputerUseService) => {
  const routes = new Hono();

  routes.get("/cua", async (c) =>
    c.json(await service.cuaStatus({ fresh: c.req.query("fresh") === "1" })),
  );

  return routes;
};
