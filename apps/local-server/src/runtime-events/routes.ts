import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { projectRuntimeEventsForStep } from "./projector.ts";

export const createRuntimeEventRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/executions/:executionId/runtime-events", async (c) => {
    const executionId = c.req.param("executionId");
    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(executionId);
    await Promise.all(steps.map((step) => projectRuntimeEventsForStep(ctx, step.id)));

    const events = await ctx.runtimeEventRepository.listByExecutionId(executionId);
    return c.json({ events });
  });

  routes.get("/executions/:executionId/usage", async (c) => {
    const executionId = c.req.param("executionId");
    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    const usage = await ctx.executionRepository.getStepUsageByExecutionId(executionId);
    const totals = usage.reduce(
      (acc, record) => ({
        inputTokens: acc.inputTokens + (record.input_tokens ?? 0),
        outputTokens: acc.outputTokens + (record.output_tokens ?? 0),
        totalTokens: acc.totalTokens + (record.total_tokens ?? 0),
        costUsd: acc.costUsd + (record.cost_usd ?? 0),
        durationMs: acc.durationMs + (record.duration_ms ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, durationMs: 0 },
    );

    return c.json({ usage, totals });
  });

  return routes;
};
