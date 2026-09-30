import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { type BriefRepo, buildCoordinatorBrief, buildThreadBrief } from "./briefs.ts";
import { MEMORY_INDEX_NAME } from "./memory-service.ts";

/** What the engine adds to a project session's turn: the role's brief and the extra folders it may read. */
export interface ProjectPromptContext {
  /** Prompt lines that replace the platform instructions plain sessions get. */
  instructions: string[];
  /** Other repos of the project, readable but not the thread's workspace. */
  readableDirectories: string[];
}

/** Null for a session that belongs to no project, or whose project or thread is gone. */
export const loadProjectPromptContext = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<ProjectPromptContext | null> => {
  if (!session.project_id) return null;
  const project = await ctx.projectRepository.getById(session.project_id);
  if (!project) return null;
  const repos = await loadRepos(ctx, project.repoIds);
  const memoryIndex = (await ctx.memoryRepository.get(project.id, MEMORY_INDEX_NAME))?.body ?? null;
  const base = { project, repos, memoryIndex };

  if (session.kind === "coordinator") {
    const threads = await ctx.threadRepository.listByProject(project.id);
    return { instructions: buildCoordinatorBrief({ ...base, threads }), readableDirectories: [] };
  }
  const thread = await ctx.threadRepository.getById(session.id);
  if (!thread) return null;
  return {
    instructions: buildThreadBrief({ ...base, thread, workspace: session.workspace_path ?? "" }),
    readableDirectories: repos.filter((repo) => repo.id !== thread.repoId).map((repo) => repo.path),
  };
};

const loadRepos = async (
  ctx: LocalServerContext,
  repoIds: readonly string[],
): Promise<BriefRepo[]> => {
  const repos = await Promise.all(repoIds.map((repoId) => ctx.repoRepository.getById(repoId)));
  return repos.flatMap((repo) =>
    repo
      ? [{ id: repo.id, name: repo.name ?? repo.path.split("/").pop() ?? repo.id, path: repo.path }]
      : [],
  );
};
