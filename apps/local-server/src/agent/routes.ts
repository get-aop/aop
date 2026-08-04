import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import type { AgentServiceError } from "./service.ts";

export const createAgentRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/", async (c) => {
    return c.json({ agents: await ctx.agentService.listAgents() });
  });

  routes.get("/hermes/profiles", async (c) => {
    return c.json({ profiles: await ctx.agentService.listHermesProfiles() });
  });

  routes.post("/manual", async (c) => {
    const result = await ctx.agentService.createManualAgent(await c.req.json());
    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ agent: result.agent }, 201);
  });

  routes.post("/workers", async (c) => {
    const result = await ctx.agentService.createWorkerProfile(await c.req.json());
    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ agent: result.agent }, 201);
  });

  routes.post("/hermes/import", async (c) => {
    const result = await ctx.agentService.integrateHermesProfile(await c.req.json());
    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ agent: result.agent }, 201);
  });

  routes.post("/", async (c) => {
    const body = await c.req.json<{
      name?: string;
      role?: "architect" | "developer" | "reviewer" | "custom";
      runtimeProvider?: "hermes" | "pi" | "codex-cli" | "opencode";
      model?: string;
      workflowId?: string;
      repoIds?: string[];
    }>();

    if (
      !body.name ||
      !body.role ||
      !body.runtimeProvider ||
      !body.model ||
      !Array.isArray(body.repoIds)
    ) {
      return c.json({ error: "Missing required agent fields" }, 400);
    }

    const result = await ctx.agentService.createAgent({
      name: body.name,
      role: body.role,
      runtimeProvider: body.runtimeProvider,
      model: body.model,
      workflowId: body.workflowId,
      repoIds: body.repoIds,
    });

    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ agent: result.agent }, 201);
  });

  routes.get("/:agentId", async (c) => {
    const agent = await ctx.agentService.getAgent(c.req.param("agentId"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({ agent });
  });

  routes.patch("/:agentId", async (c) => {
    const result = await ctx.agentService.updateAgent(
      c.req.param("agentId"),
      await c.req.json<{
        name?: string;
        role?: "architect" | "developer" | "reviewer" | "custom";
        model?: string;
        workflowId?: string;
        status?: "active" | "archived";
        autoDistributeDisabled?: boolean;
        focus?: string | null;
      }>(),
    );

    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ agent: result.agent });
  });

  routes.get("/:agentId/repos", async (c) => {
    const repoIds = await ctx.agentService.listAgentRepoIds(c.req.param("agentId"));
    if (!repoIds) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({ repoIds });
  });

  routes.put("/:agentId/repos", async (c) => {
    const body = await c.req.json<{ repoIds?: string[] }>();
    if (!Array.isArray(body.repoIds)) {
      return c.json({ error: "Missing required field: repoIds" }, 400);
    }

    const result = await ctx.agentService.replaceAgentRepos(c.req.param("agentId"), body.repoIds);
    if (!result.success) {
      return toErrorResponse(c, result.error);
    }

    return c.json({ repoIds: result.repoIds });
  });

  return routes;
};

const toErrorResponse = (c: Context, error: AgentServiceError) => {
  switch (error.code) {
    case "ACTIVE_AGENT_LIMIT_REACHED":
      return c.json({ error: "Active agent limit reached", limit: error.limit }, 409);
    case "LICENSE_NOT_VALID":
      return c.json({ error: error.message, code: "LICENSE_NOT_VALID" }, 402);
    case "AGENT_NOT_FOUND":
      return c.json({ error: "Agent not found" }, 404);
    case "INVALID_WORKFLOW":
      return c.json({ error: "Workflow not found", workflowId: error.workflowId }, 400);
    case "UNKNOWN_REPOS":
      return c.json({ error: "Unknown repo ids", repoIds: error.repoIds }, 400);
    case "DUPLICATE_NAME":
      return c.json(
        {
          error: `Worker name "${error.name}" is already used by an active profile.`,
          code: "DUPLICATE_NAME",
          name: error.name,
        },
        409,
      );
    case "INVALID_INPUT":
      return c.json({ error: error.message }, 400);
    case "HERMES_PROFILE_NOT_FOUND":
      return c.json({ error: error.message }, 404);
    case "UNSUPPORTED_PROVIDER_MODEL":
      return c.json({ error: error.message }, 400);
  }
};
