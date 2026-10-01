import { UsageWindowSchema } from "@aop/common";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createThreadChanges } from "../thread/changes.ts";
import { createUsageService } from "./service.ts";

/**
 * Read-only usage totals. A thread is a chat session, so `:threadId` is a session id (a
 * project's coordinator answers too). `since` (inclusive) and `until` (exclusive) are
 * ISO-8601 instants that bound when the runs finished; both are optional.
 */
export const createUsageRoutes = (ctx: LocalServerContext) => {
  const usage = createUsageService(ctx.db, { threadChanges: createThreadChanges(ctx) });
  const routes = new Hono();

  routes.get("/runs/:runId", async (c) => {
    const result = await usage.getRunUsage(c.req.param("runId"));
    return result ? c.json(result) : c.json({ error: "Run not found" }, 404);
  });

  routes.get("/threads/:threadId", async (c) => {
    const window = UsageWindowSchema.safeParse(windowOf(c.req.query()));
    if (!window.success) return c.json({ error: "Invalid usage window" }, 400);
    const result = await usage.getThreadUsage(c.req.param("threadId"), window.data);
    return result ? c.json(result) : c.json({ error: "Thread not found" }, 404);
  });

  routes.get("/projects/:projectId", async (c) => {
    const window = UsageWindowSchema.safeParse(windowOf(c.req.query()));
    if (!window.success) return c.json({ error: "Invalid usage window" }, 400);
    const result = await usage.getProjectUsage(c.req.param("projectId"), window.data);
    return result ? c.json(result) : c.json({ error: "Project not found" }, 404);
  });

  return routes;
};

const windowOf = (query: Record<string, string>) => ({
  since: query.since ?? null,
  until: query.until ?? null,
});
