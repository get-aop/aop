import { createChatSessionService } from "../chat-session/service.ts";
import type { ChatSessionServiceDeps } from "../chat-session/session-types.ts";
import type { LocalServerContext } from "../context.ts";
import {
  createPullRequestWatcher,
  type PullRequestWatcher,
  type PullRequestWatcherDeps,
} from "../pull-request-watch/watcher.ts";
import { createSuggestionService, type SuggestionService } from "../suggestion/service.ts";
import { createThreadGit, type ThreadGit, type ThreadGitDeps } from "../thread/git.ts";
import { createThreadService, type ThreadService } from "../thread/service.ts";
import type { ChatEngine } from "./engine.ts";
import { createProjectKickoff, type ProjectKickoff } from "./kickoff.ts";
import { createMemoryService, type MemoryService } from "./memory-service.ts";
import { createProjectService, type ProjectService } from "./service.ts";

/** The project domain's services over one chat engine: what routes and MCP tools call. */
export interface ProjectServices {
  chat: ChatEngine;
  projects: ProjectService;
  threads: ThreadService;
  /** The answers to the threads the coordinator proposes. */
  suggestions: SuggestionService;
  memory: MemoryService;
  /** A new project's first open; the server resumes kickoffs a restart left pending (see server.ts). */
  kickoff: ProjectKickoff;
  /** The git side of threads, for housekeeping that runs without a request. */
  git: ThreadGit;
  /** Watches the open pull requests of threads; the server starts it (see server.ts). */
  pullRequestWatcher: PullRequestWatcher;
}

export const createProjectServices = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
  gitDeps: ThreadGitDeps = {},
  watchDeps: PullRequestWatcherDeps = {},
): ProjectServices => {
  const chat = createChatSessionService(ctx, deps);
  // Pull request drafts run on the runtime the chat engine runs on, so one seam covers both.
  const git = createThreadGit(ctx, { createProviderFn: deps.createProviderFn, ...gitDeps });
  const threads = createThreadService(ctx, chat, git);
  const kickoff = createProjectKickoff(ctx, threads);
  const projects = createProjectService(ctx, chat, git, kickoff);
  return {
    chat,
    projects,
    threads,
    kickoff,
    suggestions: createSuggestionService(ctx, threads),
    memory: createMemoryService({
      projects: ctx.projectRepository,
      memory: ctx.memoryRepository,
      coordinator: projects,
    }),
    git,
    // The watcher reads GitHub through the same `gh` seam the threads' pull requests use.
    pullRequestWatcher: createPullRequestWatcher(
      ctx,
      { threads, git, chat },
      { runGh: gitDeps.runGh, ...watchDeps },
    ),
  };
};
