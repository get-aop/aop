import { MEMORY_INDEX_NAME } from "@aop/common";
import type { McpServerConfig } from "@aop/llm-provider";
import { resolveAopMcpUrl } from "../chat-session/run-options.ts";
import { type ComputerUseService, computerUse } from "../computer-use/service.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { ProjectMemory } from "./memory-block.ts";
import {
  buildCoordinatorSystemPrompt,
  buildThreadSystemPrompt,
  type PromptRepo,
} from "./system-prompt.ts";
import { buildThreadDigest } from "./thread-digest.ts";

/** What the engine adds to a project session's run: the system prompt for its role, the extra folders it may read, and its computer-use tools. */
export interface ProjectRunContext {
  /** Appended to the CLI's system prompt on every turn, resumed ones included. */
  systemPrompt: string;
  /** Other repos of the project, readable but not the thread's workspace. */
  readableDirectories: string[];
  /** MCP servers for computer use (see computer-use/service.ts); a coordinator never has any. */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Read fresh for each turn, so a change to the instructions or memory reaches the next one.
 * Null for a session that belongs to no project, or whose project or thread is gone.
 */
export const loadProjectRunContext = async (
  ctx: LocalServerContext,
  session: ChatSession,
  computerUseService: ComputerUseService = computerUse,
): Promise<ProjectRunContext | null> => {
  if (!session.project_id) return null;
  const project = await ctx.projectRepository.getById(session.project_id);
  if (!project) return null;
  const repos = await loadRepos(ctx, project.repoIds);
  const base = { project, repos, memory: await loadMemory(ctx, project.id) };

  if (session.kind === "coordinator") {
    return { systemPrompt: buildCoordinatorSystemPrompt(base), readableDirectories: [] };
  }
  const thread = await ctx.threadRepository.getById(session.id);
  if (!thread) return null;
  const mcpServers = await computerUseService.serversFor(
    project,
    "thread",
    resolveAopMcpUrl(session.runtime, session.id),
  );
  return {
    systemPrompt: buildThreadSystemPrompt({
      ...base,
      thread,
      workspace: session.workspace_path ?? "",
      computerUse: mcpServers !== undefined,
    }),
    readableDirectories: repos.filter((repo) => repo.id !== thread.repoId).map((repo) => repo.path),
    mcpServers,
  };
};

/**
 * Lines added to the message of each turn, for what changes too often to sit in the system
 * prompt: the coordinator's list of its threads. A thread has none. Undefined for a session that
 * is not a project session, which keeps the message's default note.
 */
export const loadTurnContext = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<string[] | undefined> => {
  if (!session.project_id) return undefined;
  if (session.kind !== "coordinator") return [];
  return buildThreadDigest(await ctx.threadRepository.listByProject(session.project_id));
};

const loadMemory = async (ctx: LocalServerContext, projectId: string): Promise<ProjectMemory> => {
  const [index, summaries] = await Promise.all([
    ctx.memoryRepository.get(projectId, MEMORY_INDEX_NAME),
    ctx.memoryRepository.summaries(projectId),
  ]);
  return {
    index: index?.body ?? null,
    topics: summaries.filter((file) => file.name !== MEMORY_INDEX_NAME),
  };
};

const loadRepos = async (
  ctx: LocalServerContext,
  repoIds: readonly string[],
): Promise<PromptRepo[]> => {
  const repos = await Promise.all(repoIds.map((repoId) => ctx.repoRepository.getById(repoId)));
  return repos.flatMap((repo) =>
    repo
      ? [{ id: repo.id, name: repo.name ?? repo.path.split("/").pop() ?? repo.id, path: repo.path }]
      : [],
  );
};
