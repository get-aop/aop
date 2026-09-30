import type { Thread } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { changeThread } from "./change.ts";
import type { ThreadCheckout } from "./checkout.ts";
import type { ThreadPullRequests } from "./pull-request.ts";
import type { ThreadResult } from "./types.ts";

const logger = getLogger("thread", "lifecycle");

/** A thread nobody has touched for this long is resolved by itself. */
export const IDLE_DAYS_BEFORE_RESOLVED = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export interface ThreadLifecycle {
  /**
   * Marks the thread resolved. Its worktree is removed and its branch kept, with whatever the
   * worktree held committed to it, so a later message can pick the work up again. A thread
   * that is working or landing its pull request is refused.
   */
  resolve: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
  /**
   * One pass of housekeeping: threads left landing by a restart are settled against GitHub, and
   * threads idle for a week are resolved. Safe to run at any time and as often as wanted.
   */
  runMaintenance: (now?: Date) => Promise<void>;
}

export const createThreadLifecycle = (
  ctx: LocalServerContext,
  checkout: ThreadCheckout,
  pullRequests: ThreadPullRequests,
): ThreadLifecycle => {
  const resolve: ThreadLifecycle["resolve"] = (threadId) => resolveThread(ctx, checkout, threadId);

  const settleLandingThreads = async (): Promise<void> => {
    const landing = await ctx.db
      .selectFrom("chat_sessions")
      .select("id")
      .where("kind", "=", "thread")
      .where("state", "=", "landing")
      .execute();
    for (const { id } of landing) {
      const synced = await pullRequests.syncPullRequest(id);
      if (!synced.success) {
        logger.warn("Landing thread {threadId} could not be settled: {code}", {
          threadId: id,
          code: synced.error.code,
        });
      }
    }
  };

  const resolveIdleThreads = async (now: Date): Promise<void> => {
    const cutoff = new Date(now.getTime() - IDLE_DAYS_BEFORE_RESOLVED * DAY_MS).toISOString();
    const idle = await ctx.db
      .selectFrom("chat_sessions")
      .select("id")
      .where("kind", "=", "thread")
      .where("state", "=", "idle")
      .where("last_activity_at", "<", cutoff)
      .execute();
    for (const { id } of idle) {
      const resolved = await resolve(id);
      if (!resolved.success) {
        logger.warn("Idle thread {threadId} was not resolved: {code}", {
          threadId: id,
          code: resolved.error.code,
        });
      }
    }
  };

  return {
    resolve,
    runMaintenance: async (now = new Date()) => {
      await settleLandingThreads();
      await resolveIdleThreads(now);
    },
  };
};

const resolveThread = async (
  ctx: LocalServerContext,
  checkout: ThreadCheckout,
  threadId: string,
): Promise<ThreadResult<{ thread: Thread }>> => {
  const thread = await ctx.threadRepository.getById(threadId);
  if (!thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };

  // The worktree goes first, and only while no turn or merge is using it: were this interrupted,
  // resolving again finds nothing left to remove.
  const parked = await checkout.park(thread, {
    afterwards: async () => {
      if (thread.status === "resolved") return;
      await changeThread(ctx, threadId, {
        status: { status: "resolved", resolvedAt: new Date().toISOString() },
      });
    },
  });
  if (!parked.success) return parked;
  const resolved = await ctx.threadRepository.getById(threadId);
  return resolved
    ? { success: true, thread: resolved }
    : { success: false, error: { code: "THREAD_NOT_FOUND" } };
};

/** Runs maintenance now and then every hour, until the returned function is called. */
export const startThreadMaintenance = (
  lifecycle: Pick<ThreadLifecycle, "runMaintenance">,
  intervalMs = MAINTENANCE_INTERVAL_MS,
): (() => void) => {
  const tick = () =>
    lifecycle.runMaintenance().catch((error) => {
      logger.error("Thread maintenance failed: {error}", { error: String(error) });
    });
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};
