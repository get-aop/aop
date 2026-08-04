import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";

export const createCreateTaskRoutes = (_ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.post("/start", (c) => deprecatedCreateTaskResponse(c));
  routes.post("/:sessionId/answer", (c) => deprecatedCreateTaskResponse(c));
  routes.post("/:sessionId/finalize", (c) => deprecatedCreateTaskResponse(c));
  routes.post("/:sessionId/cancel", (c) => deprecatedCreateTaskResponse(c));

  return routes;
};

const deprecatedCreateTaskResponse = (c: Context) =>
  c.json(
    {
      error:
        "This legacy create-task endpoint is deprecated. Use AOP Sessions or aop_create_task to generate task.md, prd.md, and issues.md directly in the backlog.",
    },
    410,
  );
