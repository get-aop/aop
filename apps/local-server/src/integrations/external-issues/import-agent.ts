import type { LocalServerContext } from "../../context.ts";

export const assertImportAgent = async (
  ctx: LocalServerContext,
  repoId: string,
  agentId: string,
): Promise<void> => {
  const agent = await ctx.agentRepository.getById(agentId);
  if (!agent) {
    throw new Error("Agent not found");
  }

  if (agent.status !== "active") {
    throw new Error("Agent is inactive");
  }

  const memberships = await ctx.agentRepository.listRepoMemberships(agentId);
  if (!memberships.some((membership) => membership.repo_id === repoId)) {
    throw new Error("Agent is not assigned to this repository");
  }
};
