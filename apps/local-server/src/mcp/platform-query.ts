import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";

/**
 * Domain query helpers for AOP MCP tools.
 * Entrypoints (mcp/tools) call these instead of repositories directly.
 */

export const listPlatformRepos = async (ctx: LocalServerContext) => {
  const repos = await ctx.repoRepository.getAll();
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path,
  }));
};

export const getPlatformRepo = async (ctx: LocalServerContext, repoId: string) => {
  return getRepoById(ctx, repoId);
};
