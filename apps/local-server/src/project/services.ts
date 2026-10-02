import { type ArtifactService, createArtifactService } from "../artifact/service.ts";
import { createVisualizeModel } from "../artifact/visualize/run.ts";
import { createVisualizeService, type VisualizeService } from "../artifact/visualize/service.ts";
import { createChatSessionService } from "../chat-session/service.ts";
import type { ChatSessionServiceDeps } from "../chat-session/session-types.ts";
import type { LocalServerContext } from "../context.ts";
import { createLibraryService, type LibraryService } from "../library/service.ts";
import {
  createPullRequestWatcher,
  type PullRequestWatcher,
  type PullRequestWatcherDeps,
} from "../pull-request-watch/watcher.ts";
import { createSuggestionService, type SuggestionService } from "../suggestion/service.ts";
import { createThreadGit, type ThreadGit, type ThreadGitDeps } from "../thread/git.ts";
import { createThreadService, type ThreadService } from "../thread/service.ts";
import { createThreadToolHealth, type ThreadToolHealth } from "../thread/tool-health.ts";
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
  /** The project's files: what its agents saved, what the person sent or added. */
  library: LibraryService;
  /** Documents agents make for the person, with their versions, kept in the Library. */
  artifacts: ArtifactService;
  /** Diagrams of replies, drawn by a small one-shot model run. */
  visualize: VisualizeService;
  /** A new project's first open; the server resumes kickoffs a restart left pending (see server.ts). */
  kickoff: ProjectKickoff;
  /** The git side of threads, for housekeeping that runs without a request. */
  git: ThreadGit;
  /** Watches the open pull requests of threads; the server starts it (see server.ts). */
  pullRequestWatcher: PullRequestWatcher;
  /** Notices threads whose AOP tools stopped reaching the host; the MCP endpoint feeds it. */
  toolHealth: ThreadToolHealth;
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
  const toolHealth = createThreadToolHealth(ctx, chat.wake);
  ctx.sessionHooks.observeThreadProgress(toolHealth.turnProgress);
  const library = createLibraryService(ctx);
  const artifacts = createArtifactService(ctx, library);
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
    library,
    artifacts,
    // Visualize runs on the same provider seam as chats, so tests hand it the fake.
    visualize: createVisualizeService(ctx, artifacts, createVisualizeModel(deps.createProviderFn)),
    git,
    // The watcher reads GitHub through the same `gh` seam the threads' pull requests use.
    pullRequestWatcher: createPullRequestWatcher(
      ctx,
      { threads, git, chat },
      { runGh: gitDeps.runGh, ...watchDeps },
    ),
    toolHealth,
  };
};
