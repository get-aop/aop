import { afterEach } from "bun:test";
import {
  createProjectStack,
  eventually,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";

export interface ThreadWorldOptions {
  /** Repos registered with the host. */
  repos?: number;
  /** How many of them the project holds; all by default. */
  projectRepos?: number;
  settings?: Parameters<typeof projectSettings>[0];
}

/**
 * A project on the fake CLI for one test file. Call it at the top of the file: it points AOP_HOME
 * at a scratch directory and tears each test's stack down afterwards.
 */
export const useThreadWorld = () => {
  const home = useTempAopHome();
  let stack: ProjectStack | undefined;

  afterEach(async () => {
    await stack?.cleanup();
    stack = undefined;
  });

  const setup = async (options: ThreadWorldOptions = {}) => {
    const s = await createProjectStack(home.path(), { repos: options.repos });
    stack = s;
    const created = await s.services.projects.create(
      projectSettings({
        repoIds: s.repos.slice(0, options.projectRepos).map((repo) => repo.id),
        ...options.settings,
      }),
    );
    if (!created.success) throw new Error("project not created");
    return { s, project: created.project };
  };

  return { setup };
};

export const spawnAndSettle = async (
  s: ProjectStack,
  projectId: string,
  input: Parameters<ProjectStack["services"]["threads"]["spawn"]>[1],
) => {
  const spawned = await s.services.threads.spawn(projectId, input);
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  await s.settle();
  const settled = await s.services.threads.get(spawned.thread.id);
  if (!settled.success) throw new Error("thread vanished");
  return settled.thread;
};

/** Resolves once the thread's CLI has started (it has a runtime session id). */
export const started = (s: ProjectStack, threadId: string) =>
  eventually(
    async () =>
      (await s.ctx.chatSessionRepository.getById(threadId))?.runtime_session_id ?? undefined,
    "the CLI to start",
  );

/** What reached the coordinator's session from elsewhere: thread reports, in order. */
export const coordinatorInbox = async (s: ProjectStack, projectId: string) => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(projectId);
  return s.db
    .selectFrom("chat_messages")
    .select(["role", "content", "origin_json", "disposition"])
    .where("session_id", "=", coordinator?.id ?? "")
    .where("origin_json", "is not", null)
    .orderBy("turn_index")
    .execute();
};
