import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import type { Agent, Repo, Task } from "../db/schema.ts";
import {
  type AgentMemorySearchTarget,
  isAgentMemoryEnabled,
  searchAgentMemory,
} from "./agentmemory.ts";

interface SearchRequestBody {
  repoId?: unknown;
  taskId?: unknown;
  agentId?: unknown;
  query?: unknown;
  limit?: unknown;
}

interface SearchScope {
  repoId: string | null;
  task: Task | null;
  agentId: string | null;
  query: string | null;
  limit: number | undefined;
}

export const createAgentMemoryRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.post("/search", async (c) => {
    const body = await c.req.json<SearchRequestBody>().catch((): SearchRequestBody => ({}));
    const scopeResult = await parseSearchScope(ctx, body);
    if (!scopeResult.success) {
      return c.json({ error: scopeResult.error }, scopeResult.status);
    }

    if (!isAgentMemoryEnabled()) {
      return c.json({ enabled: false, results: [] });
    }

    const targetsResult = await resolveSearchTargets(ctx, scopeResult.scope);
    if (!targetsResult.success) {
      return c.json({ error: targetsResult.error }, targetsResult.status);
    }

    const results = await searchAgentMemory({
      targets: targetsResult.targets,
      taskId: scopeResult.scope.task?.id ?? null,
      changePath: scopeResult.scope.task?.change_path ?? null,
      query: scopeResult.scope.query,
      limit: scopeResult.scope.limit,
    });

    return c.json({ enabled: true, results });
  });

  return routes;
};

type ScopeResult =
  | { success: true; scope: SearchScope }
  | { success: false; status: 400 | 404; error: string };

const parseSearchScope = async (
  ctx: LocalServerContext,
  body: SearchRequestBody,
): Promise<ScopeResult> => {
  const repoId = readOptionalString(body.repoId);
  const taskId = readOptionalString(body.taskId);
  const agentId = readOptionalString(body.agentId);
  const query = readOptionalString(body.query);
  const limit = readOptionalNumber(body.limit);

  if (!query && !taskId) {
    return { success: false, status: 400, error: "Search query or taskId is required" };
  }

  const task = taskId ? await ctx.taskRepository.get(taskId) : null;
  if (taskId && !task) {
    return { success: false, status: 404, error: "Task not found" };
  }

  if (repoId && task && task.repo_id !== repoId) {
    return { success: false, status: 400, error: "Task does not belong to the requested repo" };
  }

  return {
    success: true,
    scope: {
      repoId: task?.repo_id ?? repoId,
      task,
      agentId,
      query,
      limit,
    },
  };
};

type TargetsResult =
  | { success: true; targets: AgentMemorySearchTarget[] }
  | { success: false; status: 404; error: string };

const resolveSearchTargets = async (
  ctx: LocalServerContext,
  scope: SearchScope,
): Promise<TargetsResult> => {
  const repos = await ctx.repoRepository.getAll();
  const reposById = new Map(repos.map((repo) => [repo.id, repo]));

  if (scope.repoId && !reposById.has(scope.repoId)) {
    return { success: false, status: 404, error: "Repo not found" };
  }

  const agents = scope.agentId
    ? await getActiveAgentById(ctx, scope.agentId)
    : await ctx.agentRepository.listActive();
  if (!agents) {
    return { success: false, status: 404, error: "Agent not found" };
  }

  const targets = (
    await Promise.all(
      agents.map((agent) => buildTargetsForAgent(ctx, agent, reposById, scope.repoId)),
    )
  ).flat();

  return { success: true, targets };
};

const getActiveAgentById = async (
  ctx: LocalServerContext,
  agentId: string,
): Promise<Agent[] | null> => {
  const agent = await ctx.agentRepository.getById(agentId);
  if (agent?.status !== "active") return null;
  return [agent];
};

const buildTargetsForAgent = async (
  ctx: LocalServerContext,
  agent: Agent,
  reposById: Map<string, Repo>,
  repoId: string | null,
): Promise<AgentMemorySearchTarget[]> => {
  const memberships = await ctx.agentRepository.listRepoMemberships(agent.id);

  return memberships.flatMap((membership) => {
    if (repoId && membership.repo_id !== repoId) return [];
    const repo = reposById.get(membership.repo_id);
    if (!repo) return [];

    return [
      {
        agentId: agent.id,
        agentName: agent.name,
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
      },
    ];
  });
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
};
