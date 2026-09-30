import type { Project, ProjectSettings, Thread } from "@aop/common";
import { aopPaths } from "@aop/infra";
import { createProjectStack, type ProjectStack, projectSettings } from "../project/test-utils.ts";
import type { PullRequestWatcherDeps } from "../pull-request-watch/watcher.ts";
import type { GenerateSessionPrDraft } from "../session-git/pull-request.ts";
import type { ThreadGitDeps } from "./git.ts";
import { createFakeGithub } from "./git-test-utils.ts";

export interface PrWorld {
  s: ProjectStack;
  project: Project;
  repo: { id: string; path: string; origin: string };
  github: ReturnType<typeof createFakeGithub>;
}

const stubDraft: GenerateSessionPrDraft = async () => ({
  title: "Fix the cold start",
  body: "Removes the eager initialisation.",
});

/**
 * A project with one repo whose origin is a bare repository on disk, and a GitHub that lives in
 * memory behind the `gh` seam: a thread can commit, push and open pull requests with nothing
 * leaving the machine. `git` overrides the seams (a flaky git, another draft writer).
 */
export const setupPrWorld = async (
  aopHome: string,
  options: {
    git?: ThreadGitDeps;
    mcp?: boolean;
    watch?: PullRequestWatcherDeps;
    /** How many repos the project has; `repo` is the first. */
    repos?: number;
    settings?: Partial<ProjectSettings>;
  } = {},
): Promise<PrWorld> => {
  const github = createFakeGithub();
  const s = await createProjectStack(aopHome, {
    origin: true,
    mcp: options.mcp,
    repos: options.repos,
    watch: options.watch,
    git: { runGh: github.run, generateDraft: stubDraft, ...options.git },
  });
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id), ...options.settings }),
  );
  if (!created.success) throw new Error("project not created");
  const [repo] = s.repos as { id: string; path: string; origin: string }[];
  if (!repo) throw new Error("no repo");
  return { s, project: created.project, repo, github };
};

/** Spawns a thread whose turn writes `notes.md` in its worktree, and waits for the turn to end. */
export const spawnWithWork = async (
  world: PrWorld,
  title = "Fix the cold start",
): Promise<Thread> => {
  const { s, project } = world;
  const spawned = await s.services.threads.spawn(project.id, {
    title,
    prompt: 'Fix it [fake: write="notes.md=cold start fixed"]',
  });
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  await s.settle();
  return reloadThread(s, spawned.thread.id);
};

export const reloadThread = async (s: ProjectStack, threadId: string): Promise<Thread> => {
  const found = await s.services.threads.get(threadId);
  if (!found.success) throw new Error(`thread ${threadId} not found`);
  return found.thread;
};

export const worktreeOf = (world: PrWorld, thread: Thread): string =>
  aopPaths.worktree(world.repo.id, thread.id);

/** The statuses a thread moved through, read from its `thread.upserted` entries in the event log. */
export const statusesInLog = async (s: ProjectStack, threadId: string): Promise<string[]> => {
  const rows = await s.db
    .selectFrom("event_log")
    .select("payload")
    .where("type", "=", "thread.upserted")
    .orderBy("id")
    .execute();
  return rows
    .map((row) => (JSON.parse(row.payload) as { thread: Thread }).thread)
    .filter((thread) => thread.id === threadId)
    .map((thread) => thread.status)
    .filter((status, index, all) => status !== all[index - 1]);
};
