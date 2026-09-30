import { Hono } from "hono";
import { getProviderCapabilities } from "./capabilities.ts";

interface ProviderRouteDeps {
  getCapabilities?: typeof getProviderCapabilities;
}

export const createProviderRoutes = (deps: ProviderRouteDeps = {}) => {
  const routes = new Hono();
  const loadCapabilities = deps.getCapabilities ?? getProviderCapabilities;

  routes.get("/providers/capabilities", async (c) =>
    c.json({ providers: await loadCapabilities() }),
  );

  return routes;
};
