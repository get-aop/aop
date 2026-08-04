import { Hono } from "hono";
import { getProviderCapabilities } from "./capabilities.ts";
import { type ProviderUpdateService, providerUpdateService } from "./provider-updates.ts";

interface ProviderRouteDeps {
  getCapabilities?: typeof getProviderCapabilities;
  updater?: ProviderUpdateService;
}

export const createProviderRoutes = (deps: ProviderRouteDeps = {}) => {
  const routes = new Hono();
  const loadCapabilities = deps.getCapabilities ?? getProviderCapabilities;
  const updater = deps.updater ?? providerUpdateService;

  routes.get("/providers/capabilities", async (c) =>
    c.json({ providers: await loadCapabilities() }),
  );

  routes.get("/providers/update-status", (c) => c.json({ states: updater.getStates() }));

  routes.post("/providers/update-all", async (c) => {
    const result = await updater.startAll();
    return c.json(result, result.accepted ? 202 : 409);
  });

  return routes;
};
