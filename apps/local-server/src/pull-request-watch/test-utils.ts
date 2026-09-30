import { afterEach } from "bun:test";
import type { Thread } from "@aop/common";
import { useTempAopHome } from "../project/test-utils.ts";
import { type PrWorld, reloadThread, setupPrWorld } from "../thread/pr-test-utils.ts";
import { coordinatorInbox } from "../thread/test-utils.ts";
import type { WatchEntry } from "./ledger.ts";
import { createWatchRepository } from "./repository.ts";
import type { PullRequestWatcher } from "./watcher.ts";

export const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;

export interface WatchWorld extends PrWorld {
  /** The watcher's clock: move it on to make a poll due. */
  clock: { now: number };
  watcher: PullRequestWatcher;
  /** Moves the clock on, runs one pass and waits for the turns it started. */
  tick: (advanceMs?: number) => Promise<void>;
}

type WorldOptions = Parameters<typeof setupPrWorld>[1];

/**
 * A project on the fake CLI and the in-memory GitHub, with a watcher whose clock the test owns
 * and whose delays are exact (no jitter). Call it at the top of the file.
 */
export const useWatchWorld = () => {
  const home = useTempAopHome();
  let world: WatchWorld | undefined;

  afterEach(async () => {
    await world?.s.cleanup();
    world = undefined;
  });

  const setup = async (options: WorldOptions = {}): Promise<WatchWorld> => {
    const clock = { now: T0 };
    const base = await setupPrWorld(home.path(), {
      ...options,
      watch: { now: () => new Date(clock.now), random: () => 0.5, ...options?.watch },
    });
    const watcher = base.s.services.pullRequestWatcher;
    world = {
      ...base,
      clock,
      watcher,
      tick: async (advanceMs = 0) => {
        clock.now += advanceMs;
        await watcher.tick();
        await base.s.settle();
      },
    };
    return world;
  };

  return { setup };
};

/** A thread that did some work and has its pull request open; the pull request is number 1 in a new world. */
export const openedThread = async (
  world: WatchWorld,
  options: { title?: string; repoId?: string } = {},
): Promise<{ thread: Thread; number: number }> => {
  const { s, project } = world;
  const spawned = await s.services.threads.spawn(project.id, {
    title: options.title ?? "Fix the cold start",
    repoId: options.repoId,
    prompt: 'Fix it [fake: write="notes.md=cold start fixed"]',
  });
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  await s.settle();
  const opened = await s.services.threads.openPullRequest(spawned.thread.id, {});
  if (!opened.success) throw new Error(`not opened: ${JSON.stringify(opened.error)}`);
  return { thread: await reloadThread(s, spawned.thread.id), number: opened.pullRequest.number };
};

/** What the watcher sent a thread, as the text of each message, oldest first. */
export const fixPrompts = async (world: WatchWorld, threadId: string): Promise<string[]> => {
  const listed = await world.s.services.threads.listMessages(threadId);
  if (!listed.success) throw new Error("thread not found");
  return listed.messages.flatMap((message) =>
    message.role === "user" && message.text.startsWith("Automatic fix") ? [message.text] : [],
  );
};

/** What reached the coordinator's inbox from threads, as `outcome: text`, oldest first. */
export const reportsToCoordinator = async (world: WatchWorld, projectId: string) =>
  (await coordinatorInbox(world.s, projectId)).flatMap((row) => {
    const origin = JSON.parse(row.origin_json ?? "null") as {
      type: string;
      outcome: string;
    } | null;
    return origin?.type === "thread-report" ? [`${origin.outcome}: ${row.content}`] : [];
  });

export const ledgerOf = (world: WatchWorld, threadId: string): Promise<WatchEntry[]> =>
  createWatchRepository(world.s.db).entries(threadId);

/** How many `thread.upserted` entries on the project stream carry this pull request's checks summary. */
export const checksEntries = async (world: WatchWorld, threadId: string) => {
  const rows = await world.s.db
    .selectFrom("event_log")
    .select("payload")
    .where("type", "=", "thread.upserted")
    .orderBy("id")
    .execute();
  return rows
    .map((row) => (JSON.parse(row.payload) as { thread: Thread }).thread)
    .filter((thread) => thread.id === threadId)
    .flatMap((thread) => {
      const pr = thread.artifacts.find((artifact) => artifact.type === "pr");
      return pr?.checks ? [pr.checks] : [];
    });
};
