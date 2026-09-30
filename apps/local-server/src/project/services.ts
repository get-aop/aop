import { createChatSessionService } from "../chat-session/service.ts";
import type { ChatSessionServiceDeps } from "../chat-session/session-types.ts";
import type { LocalServerContext } from "../context.ts";
import { createThreadGit, type ThreadGit, type ThreadGitDeps } from "../thread/git.ts";
import { createThreadService, type ThreadService } from "../thread/service.ts";
import type { ChatEngine } from "./engine.ts";
import { createMemoryService, type MemoryService } from "./memory-service.ts";
import { createProjectService, type ProjectService } from "./service.ts";

/** The project domain's services over one chat engine: what routes and MCP tools call. */
export interface ProjectServices {
  chat: ChatEngine;
  projects: ProjectService;
  threads: ThreadService;
  memory: MemoryService;
  /** The git side of threads, for housekeeping that runs without a request. */
  git: ThreadGit;
}

export const createProjectServices = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
  gitDeps: ThreadGitDeps = {},
): ProjectServices => {
  const chat = createChatSessionService(ctx, deps);
  // Pull request drafts run on the runtime the chat engine runs on, so one seam covers both.
  const git = createThreadGit(ctx, { createProviderFn: deps.createProviderFn, ...gitDeps });
  return {
    chat,
    projects: createProjectService(ctx, chat, git),
    threads: createThreadService(ctx, chat, git),
    memory: createMemoryService({ projects: ctx.projectRepository, memory: ctx.memoryRepository }),
    git,
  };
};
