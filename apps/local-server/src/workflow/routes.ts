import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import {
  createSkillBlock,
  createWorkflowFromSteps,
  deleteSkillBlock,
  deleteWorkflow,
  listStepLibrary,
  listWorkflowDetails,
  listWorkflows,
} from "./handlers.ts";

export const createWorkflowRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/details", async (c) => {
    const result = await listWorkflowDetails(ctx.workflowService);
    return c.json(result);
  });

  routes.get("/step-library", async (c) => {
    return c.json(await listStepLibrary(ctx.workflowService));
  });

  routes.post("/step-library", async (c) => {
    try {
      const result = await createSkillBlock(ctx.workflowService, await c.req.json());
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unable to save step block" },
        400,
      );
    }
  });

  routes.delete("/step-library/:id", async (c) => {
    try {
      await deleteSkillBlock(ctx.workflowService, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unable to delete step block" },
        400,
      );
    }
  });

  routes.get("/", async (c) => {
    const result = await listWorkflows(ctx.workflowService);
    return c.json(result);
  });

  routes.post("/", async (c) => {
    try {
      const result = await createWorkflowFromSteps(ctx.workflowService, await c.req.json());
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unable to save workflow" },
        400,
      );
    }
  });

  routes.delete("/:id", async (c) => {
    try {
      await deleteWorkflow(ctx.workflowService, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unable to delete workflow" },
        400,
      );
    }
  });

  return routes;
};
