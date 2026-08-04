import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";

export const createSchedulerRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/repos/:repoId/scheduler/triggers", async (c) => {
    const repoId = c.req.param("repoId");
    const triggers = await ctx.schedulerService.listTriggers(repoId);
    return c.json({ triggers });
  });

  routes.post("/repos/:repoId/scheduler/triggers", async (c) => {
    const repoId = c.req.param("repoId");
    const body = await c.req.json();
    const trigger = await ctx.schedulerService.createTrigger({
      repoId,
      name: body.name,
      action: body.action,
      cadenceSecs: body.cadenceSecs,
      maxItemsPerRun: body.maxItemsPerRun,
      enabled: body.enabled,
      requireApprovalBeforeHandoff: body.requireApprovalBeforeHandoff,
      allowedSources: body.allowedSources,
    });
    return c.json({ trigger }, 201);
  });

  routes.patch("/repos/:repoId/scheduler/triggers/:triggerId", async (c) => {
    const triggerId = c.req.param("triggerId");
    const body = await c.req.json();
    const trigger = await ctx.schedulerService.updateTrigger(triggerId, {
      cadenceSecs: body.cadenceSecs,
      enabled: body.enabled,
      maxItemsPerRun: body.maxItemsPerRun,
      requireApprovalBeforeHandoff: body.requireApprovalBeforeHandoff,
      allowedSources: body.allowedSources,
    });
    if (!trigger) return c.json({ error: "Trigger not found" }, 404);
    return c.json({ trigger });
  });

  routes.delete("/repos/:repoId/scheduler/triggers/:triggerId", async (c) => {
    const triggerId = c.req.param("triggerId");
    const deleted = await ctx.schedulerService.deleteTrigger(triggerId);
    if (!deleted) return c.json({ error: "Trigger not found" }, 404);
    return c.json({ ok: true });
  });

  routes.post("/repos/:repoId/scheduler/triggers/:triggerId/run", async (c) => {
    const triggerId = c.req.param("triggerId");
    const result = await ctx.schedulerService.runTrigger(triggerId);
    return c.json({ result });
  });

  return routes;
};
