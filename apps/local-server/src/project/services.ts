import { createChatSessionService } from "../chat-session/service.ts";
import type { ChatSessionServiceDeps } from "../chat-session/session-types.ts";
import type { LocalServerContext } from "../context.ts";
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
}

export const createProjectServices = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
): ProjectServices => {
  const chat = createChatSessionService(ctx, deps);
  return {
    chat,
    projects: createProjectService(ctx, chat),
    threads: createThreadService(ctx, chat),
    memory: createMemoryService({ projects: ctx.projectRepository, memory: ctx.memoryRepository }),
  };
};
