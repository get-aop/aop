import type { Thread } from "@aop/common";
import { resolveAssistantLifecycle } from "../chat-session/session-lifecycle.ts";
import type { LocalServerContext } from "../context.ts";
import { hasQueuedMessage } from "../scheduling/queue.ts";
import { defaultRunGit, type RunGit } from "../session-git/service.ts";
import { createKeyedQueue } from "./keyed-queue.ts";
import type { ThreadError } from "./types.ts";
import {
  chooseBranchName,
  ensureWorktree,
  releaseWorktree,
  type WorktreeResult,
} from "./worktree.ts";

/** What of a thread its checkout needs. A thread with no repo or no branch has no checkout. */
export type CheckoutThread = Pick<Thread, "id" | "title" | "repoId" | "branch">;

export type CheckoutResult =
  | { success: true }
  | {
      success: false;
      error: Extract<ThreadError, { code: "WORKTREE_FAILED" | "THREAD_BUSY" }>;
    };

export interface ReleaseOptions {
  /** Discard only: also removes the branch from origin. */
  remote?: boolean;
  /** The caller is the merge that put the thread in `landing`, so that status is no reason to wait. */
  landing?: boolean;
  /**
   * Runs once the worktree is gone, still before any turn can start: the record that says so.
   * It does not run when the release is refused or fails.
   */
  afterwards?: () => Promise<void>;
}

/**
 * A thread's git worktree, by thread. Every method can be run again after a crash or a failure
 * and ends in the same state. Calls for one thread run one at a time, and starting a turn
 * (`holding`) is one of them, so a worktree is never removed under a turn: a release is refused
 * as busy while the thread has a turn running or a message waiting.
 */
export interface ThreadCheckout {
  /** The branch a new thread gets in the repo: named from its title and id, and not one that exists. */
  chooseBranch: (repoPath: string, threadId: string, title: string) => Promise<string>;
  /** Makes sure the worktree exists, so a turn can run in it. */
  provision: (thread: CheckoutThread) => Promise<CheckoutResult>;
  /**
   * Makes sure the worktree exists, then runs `start` (which starts the turn) before any release can
   * run. `allowed`, when given, is asked first, in the thread's turn in the queue and so with no
   * release able to change the thread meanwhile: a thread it refuses is answered as busy and its
   * worktree is not made.
   */
  holding: <T>(
    thread: CheckoutThread,
    start: () => Promise<T>,
    allowed?: () => Promise<boolean>,
  ) => Promise<{ success: true; value: T } | Extract<CheckoutResult, { success: false }>>;
  /** Removes the worktree and keeps the branch, after committing what the worktree held. */
  park: (thread: CheckoutThread, options?: ReleaseOptions) => Promise<CheckoutResult>;
  /** Removes the worktree and the branch. */
  discard: (thread: CheckoutThread, options?: ReleaseOptions) => Promise<CheckoutResult>;
}

export const createThreadCheckout = (
  ctx: LocalServerContext,
  deps: { runGit?: RunGit } = {},
): ThreadCheckout => {
  const runGit = deps.runGit ?? defaultRunGit;
  const queue = createKeyedQueue();

  // A turn that is running, queued for a free run slot (a message with no run yet), or waiting out
  // a rate limit (`resumes_at`, the timer that starts it again) is a turn that will run in the worktree.
  const hasTurn = async (threadId: string): Promise<boolean> => {
    if ((await resolveAssistantLifecycle(ctx, threadId)) !== "idle") return true;
    if (await hasQueuedMessage(ctx.db, threadId)) return true;
    const session = await ctx.db
      .selectFrom("chat_sessions")
      .select("resumes_at")
      .where("id", "=", threadId)
      .executeTakeFirst();
    return Boolean(session?.resumes_at);
  };

  // Parking is also refused for a thread the person or a merge has not finished with; deleting is
  // the person asking for the work to go, so only a turn that is, or will be, running stops it.
  const isBusy = async (thread: CheckoutThread, keep: boolean, landing: boolean) => {
    if (await hasTurn(thread.id)) return true;
    const status = keep ? (await ctx.threadRepository.getById(thread.id))?.status : undefined;
    if (status === "landing") return !landing;
    return status === "working" || status === "queued" || status === "rate-limited";
  };

  // Not queued itself: every caller is already inside the thread's turn in the queue.
  const perform = async (
    thread: CheckoutThread,
    action: (repo: { id: string; path: string }, branch: string) => Promise<WorktreeResult>,
  ): Promise<CheckoutResult> => {
    if (!thread.repoId || !thread.branch) return { success: true };
    const repo = await ctx.repoRepository.getById(thread.repoId);
    if (!repo) return failed(`Repository ${thread.repoId} no longer exists`);
    const done = await action(repo, thread.branch);
    return done.ok ? { success: true } : failed(done.message);
  };

  const provision = (thread: CheckoutThread) =>
    perform(thread, (repo, branch) => ensureWorktree(runGit, repo, thread.id, branch));

  const release = (thread: CheckoutThread, keep: boolean, options: ReleaseOptions) =>
    queue(thread.id, async (): Promise<CheckoutResult> => {
      if (await isBusy(thread, keep, options.landing ?? false)) return busy;
      const released = await perform(thread, (repo, branch) =>
        releaseWorktree(runGit, repo, thread.id, branch, {
          keepBranch: keep,
          deleteRemote: options.remote,
          title: thread.title,
        }),
      );
      if (released.success) await options.afterwards?.();
      return released;
    });

  return {
    chooseBranch: (repoPath, threadId, title) =>
      chooseBranchName(runGit, repoPath, threadId, title),

    provision: (thread) => queue(thread.id, () => provision(thread)),

    holding: (thread, start, allowed) =>
      queue(thread.id, async () => {
        if (allowed && !(await allowed())) return busy;
        const ready = await provision(thread);
        return ready.success ? { success: true as const, value: await start() } : ready;
      }),

    park: (thread, options = {}) => release(thread, true, options),

    discard: (thread, options = {}) => release(thread, false, options),
  };
};

const busy = { success: false as const, error: { code: "THREAD_BUSY" as const } };

const failed = (message: string): CheckoutResult => ({
  success: false,
  error: { code: "WORKTREE_FAILED", message },
});
