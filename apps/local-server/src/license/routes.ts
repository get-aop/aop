import { LICENSE_PRICING } from "@aop/license";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
export const createLicenseRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/status", async (c) => {
    const activeWorkers = await ctx.agentRepository.countActive();
    const status = await ctx.licenseService.getStatus(activeWorkers);
    return c.json({ status });
  });

  routes.post("/activate", async (c) => {
    const body = await c.req.json<{ licenseKey?: string }>();
    const licenseKey = body.licenseKey?.trim() ?? "";
    if (!licenseKey) {
      return c.json({ error: "licenseKey is required" }, 400);
    }

    const result = await ctx.licenseService.activate(licenseKey);
    if (!result.success) {
      return c.json({ error: result.message }, 400);
    }

    return c.json({ status: result.status });
  });

  routes.post("/clear", async (c) => {
    const activeWorkers = await ctx.agentRepository.countActive();
    const status = await ctx.licenseService.clear();
    return c.json({ status: { ...status, activeWorkers } });
  });

  routes.get("/pricing", async (c) => {
    const checkoutProUrl = process.env.AOP_CHECKOUT_PRO_URL ?? "";
    const checkoutTeamUrl = process.env.AOP_CHECKOUT_TEAM_URL ?? "";
    return c.json({
      tiers: [
        {
          plan: "free",
          priceUsdMonthly: LICENSE_PRICING.free.priceUsdMonthly,
          maxActiveWorkers: LICENSE_PRICING.free.maxActiveWorkers,
          checkoutUrl: null,
        },
        {
          plan: "pro",
          priceUsdMonthly: LICENSE_PRICING.pro.priceUsdMonthly,
          maxActiveWorkers: LICENSE_PRICING.pro.maxActiveWorkers,
          checkoutUrl: checkoutProUrl || null,
        },
        {
          plan: "team",
          priceUsdMonthly: LICENSE_PRICING.team.priceUsdMonthly,
          maxActiveWorkers: LICENSE_PRICING.team.maxActiveWorkers,
          checkoutUrl: checkoutTeamUrl || null,
        },
      ],
    });
  });

  return routes;
};
