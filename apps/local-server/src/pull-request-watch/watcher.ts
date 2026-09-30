import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { defaultRunGh, type RunGh } from "../github-cli/index.ts";
import type { ChatEngine } from "../project/engine.ts";
import type { ThreadGit } from "../thread/git.ts";
import { createKeyedQueue } from "../thread/keyed-queue.ts";
import type { ThreadService } from "../thread/service.ts";
import type { ThreadResult } from "../thread/types.ts";
import type { WatchEnv } from "./env.ts";
import { type PollResult, pollPullRequest } from "./poll.ts";
import { createWatchRepository, type WatchedThread } from "./repository.ts";
import {
  afterPoll,
  blockedUntil,
  DEFAULT_TIMING,
  dueNow,
  type Schedule,
  type Timing,
} from "./schedule.ts";
import { summarizeWatch, type WatchSummary } from "./summary.ts";

const logger = getLogger("pull-request-watch");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_CONCURRENT_POLLS = 4;

export interface PullRequestWatcherDeps {
  /** The `gh` seam; the same one the thread's git operations use. */
  runGh?: RunGh;
  maxAttempts?: number;
  /** How many pull requests are polled at once, across repositories; one repository is polled one at a time. */
  maxConcurrent?: number;
  timing?: Partial<Timing>;
  now?: () => Date;
  random?: () => number;
}

/** What the watcher needs from the domain: the ways in that a person's message and a merge take. */
export interface PullRequestWatcherServices {
  threads: Pick<ThreadService, "send">;
  git: Pick<ThreadGit, "syncPullRequest">;
  chat: Pick<ChatEngine, "wake">;
}

export interface PullRequestWatcher {
  /**
   * One pass: polls every open pull request that is due and waits for those polls to finish.
   * Polls run side by side up to the limit, one repository at a time, and a pull request that is
   * not due, or whose repository GitHub is throttling, is left for a later pass. Calls that overlap share one pass.
   */
  tick: () => Promise<void>;
  /** What the watcher has done for a thread's pull request. */
  summary: (threadId: string) => Promise<ThreadResult<{ watch: WatchSummary }>>;
}

/**
 * Watches the pull requests of threads that are open: their checks, their reviews and whether
 * they merged. What it finds is published on the project's event log and answered with a fix
 * prompt to the thread; see poll.ts and auto-fix.ts. Nothing is kept in memory that a restart
 * would miss but when to look next: what was already answered is stored (ledger.ts).
 */
export const createPullRequestWatcher = (
  ctx: LocalServerContext,
  services: PullRequestWatcherServices,
  deps: PullRequestWatcherDeps = {},
): PullRequestWatcher => {
  const clock = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_POLLS;
  const env: WatchEnv = {
    ctx,
    runGh: deps.runGh ?? defaultRunGh,
    repository: createWatchRepository(ctx.db),
    send: services.threads.send,
    syncPullRequest: services.git.syncPullRequest,
    wake: services.chat.wake,
    maxAttempts: deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    now: clock,
  };
  const schedules = new Map<string, Schedule>();
  const throttled = new Map<string, number>();
  const oneAtATime = createKeyedQueue();

  const isDue = ({ threadId, repoId }: WatchedThread, now: number): boolean => {
    const schedule = schedules.get(threadId) ?? dueNow(now);
    schedules.set(threadId, schedule);
    return schedule.nextAt <= now && (throttled.get(repoId) ?? 0) <= now;
  };

  // A poll that throws (the database closing, gh missing) is a failed poll: it backs off like one.
  const poll = async (threadId: string): Promise<PollResult> => {
    try {
      return await oneAtATime(threadId, () => pollPullRequest(env, threadId));
    } catch (error) {
      return { kind: "failed", message: String(error), rateLimited: false };
    }
  };

  const pollAndSchedule = async ({ threadId, repoId }: WatchedThread): Promise<void> => {
    const result = await poll(threadId);
    const now = clock().getTime();
    if (result.kind === "failed") {
      logger.warn("Polling the pull request of thread {threadId} failed: {message}", {
        threadId,
        message: result.message,
      });
      if (result.rateLimited) throttled.set(repoId, blockedUntil(now, timing, random));
    }
    const previous = schedules.get(threadId) ?? dueNow(now);
    schedules.set(threadId, afterPoll(previous, result, now, timing, random));
  };

  const pass = async (): Promise<void> => {
    const open = await env.repository.listOpen();
    const ids = new Set(open.map(({ threadId }) => threadId));
    for (const threadId of [...schedules.keys()])
      if (!ids.has(threadId)) schedules.delete(threadId);
    const now = clock().getTime();
    const due = open.filter((item) => isDue(item, now));
    await mapLimit(groupByRepo(due), maxConcurrent, async (group) => {
      for (const item of group) {
        // A repository GitHub began throttling mid-pass is left alone until it is over.
        if ((throttled.get(item.repoId) ?? 0) > clock().getTime()) break;
        await pollAndSchedule(item);
      }
    });
  };

  let running: Promise<void> | null = null;

  return {
    tick: () => {
      running ??= pass().finally(() => {
        running = null;
      });
      return running;
    },
    summary: (threadId) => summarizeWatch(env, threadId),
  };
};

const groupByRepo = (items: readonly WatchedThread[]): WatchedThread[][] => {
  const groups = new Map<string, WatchedThread[]>();
  for (const item of items) groups.set(item.repoId, [...(groups.get(item.repoId) ?? []), item]);
  return [...groups.values()];
};

/** Runs `work` on every item, at most `limit` at a time, and waits for all of them. */
const mapLimit = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

/** How often the server looks for pull requests that are due; each one still keeps its own schedule. */
const SCAN_INTERVAL_MS = 5_000;
/** A shutdown waits this long for a pass under way before it closes the database under it. */
const STOP_WAIT_MS = 2_000;

/**
 * Runs a pass now and then regularly, until the returned function is called; that waits a
 * moment for a pass under way. A `paceMs` faster than the scan interval speeds the scan up to it.
 */
export const startPullRequestWatcher = (
  watcher: Pick<PullRequestWatcher, "tick">,
  paceMs?: number,
): (() => Promise<void>) => {
  let inFlight: Promise<void> = Promise.resolve();
  const run = () => {
    inFlight = watcher.tick().catch((error) => {
      logger.error("Watching pull requests failed: {error}", { error: String(error) });
    });
  };
  run();
  const timer = setInterval(run, Math.min(SCAN_INTERVAL_MS, paceMs ?? SCAN_INTERVAL_MS));
  timer.unref();
  return async () => {
    clearInterval(timer);
    await Promise.race([inFlight, Bun.sleep(STOP_WAIT_MS)]);
  };
};
