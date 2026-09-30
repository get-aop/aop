import { existsSync } from "node:fs";
import type { PullRequestRef, Thread, ThreadStatus } from "@aop/common";
import { aopPaths, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import { findPullRequestByHead, type GhPullRequestRef, type RunGh } from "../github-cli/index.ts";
import { checkGhAvailable } from "../session-git/pull-request-context.ts";
import type { RunGit } from "../session-git/service.ts";
import { changeThread, changeThreadFrom } from "./change.ts";
import type { ThreadCheckout } from "./checkout.ts";
import { statusChangeOf } from "./state.ts";
import type { ThreadError } from "./types.ts";

const logger = getLogger("thread", "pull-request");

/** What every pull request operation works with. */
export interface PullRequestEnv {
  ctx: LocalServerContext;
  checkout: ThreadCheckout;
  runGit: RunGit;
  runGh: RunGh;
}

export const failure = (error: ThreadError) => ({ success: false as const, error });

/** A refusal from the git or gh layer, which names it by `code` and sometimes explains it. */
export const pullRequestFailure = (refusal: { code: string; message?: string }): ThreadError => ({
  code: "PULL_REQUEST_FAILED",
  reason: refusal.code,
  message: refusal.message ?? refusal.code,
});

/** What an operation refuses on top of an unknown thread or one with no branch. */
export interface Gate {
  /** A paused or archived project changes nothing. */
  active?: boolean;
  /** A thread that is working is left to finish: its worktree is in use. */
  idle?: boolean;
}

export type Target = { thread: Thread; repo: Repo; branch: string };

/** The thread a pull request operation is about, with its repo and branch, or why it cannot be one. */
export const loadTarget = async (env: PullRequestEnv, threadId: string, gate: Gate = {}) => {
  const thread = await env.ctx.threadRepository.getById(threadId);
  if (!thread) return failure({ code: "THREAD_NOT_FOUND" });
  const refused = await refusal(env.ctx, thread, gate);
  if (refused) return failure(refused);
  const repo = thread.repoId ? await env.ctx.repoRepository.getById(thread.repoId) : null;
  if (!repo || !thread.branch) return failure({ code: "NO_REPOSITORY" });
  return { thread, repo, branch: thread.branch };
};

const refusal = async (
  ctx: LocalServerContext,
  thread: Thread,
  gate: Gate,
): Promise<ThreadError | null> => {
  const project = gate.active ? await ctx.projectRepository.getById(thread.projectId) : null;
  if (project && project.status !== "active") {
    return { code: "PROJECT_NOT_ACTIVE", status: project.status };
  }
  return gate.idle && thread.status === "working" ? { code: "THREAD_BUSY" } : null;
};

/** The thread's pull request as GitHub has it, or null when GitHub has none for its branch. */
export const readPullRequest = async (env: PullRequestEnv, repo: Repo, branch: string) => {
  const gh = await checkGhAvailable(env.runGh, repo.path);
  if (!gh.ok) return failure(pullRequestFailure({ code: "GH_UNAVAILABLE", message: gh.message }));
  return { found: await findPullRequestByHead(env.runGh, repo.path, branch) };
};

export const stateOf = (pullRequest: GhPullRequestRef): PullRequestRef["state"] => {
  if (pullRequest.state === "OPEN") return "open";
  return pullRequest.state === "MERGED" ? "merged" : "closed";
};

/** Where a thread goes when the merge it was landing did not happen. */
export const restingStatus = (thread: Thread) =>
  thread.status === "landing" ? { status: "ready-for-review" as const } : statusChangeOf(thread);

/**
 * Work the branch holds that GitHub's copy lacks: changes not committed, or commits not pushed.
 * A branch that is already gone holds none.
 */
export const hasUnpublishedWork = async (
  env: PullRequestEnv,
  { thread, repo, branch }: Target,
): Promise<boolean> => {
  const worktree = aopPaths.worktree(repo.id, thread.id);
  if (existsSync(worktree)) {
    const status = await env.runGit(["status", "--porcelain"], worktree);
    if (status.exitCode !== 0 || status.stdout.trim()) return true;
  }
  const ahead = await env.runGit(
    ["rev-list", "--count", `refs/remotes/origin/${branch}..refs/heads/${branch}`],
    repo.path,
  );
  if (ahead.exitCode === 0) return Number.parseInt(ahead.stdout.trim(), 10) > 0;
  // No comparison to make: the branch is unpublished if it is there at all.
  const local = await env.runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repo.path,
  );
  return local.exitCode === 0;
};

/**
 * The merge happened: the thread is resolved with its pull request merged, and its checkout,
 * which has nothing left to carry, is removed. A branch that holds work the merged pull request
 * does not have is kept, with that work committed, rather than deleted. The record is written
 * once the worktree is gone and while no turn can start, so a crash before it leaves a state that
 * running this again finishes. A thread with a turn running is not touched: the merge is recorded
 * as a fact and the thread carries on, to be resolved later.
 */
export const land = async (env: PullRequestEnv, target: Target, pullRequest: PullRequestRef) => {
  const { thread } = target;
  const merged = { ...pullRequest, state: "merged" as const };
  const keep = await hasUnpublishedWork(env, target);
  if (keep) {
    logger.warn("Thread {threadId} merged, but its branch holds work the pull request lacks", {
      threadId: thread.id,
    });
  }
  const resolvedAt = thread.status === "resolved" ? thread.resolvedAt : new Date().toISOString();
  const options = {
    landing: true,
    remote: true,
    afterwards: async () => {
      await changeThread(env.ctx, thread.id, {
        pullRequest: merged,
        status: { status: "resolved", resolvedAt },
        lastActivityAt: new Date().toISOString(),
      });
    },
  };
  const released = keep
    ? await env.checkout.park(thread, options)
    : await env.checkout.discard(thread, options);
  if (released.success) return { success: true as const, thread: await reload(env, thread) };

  if (released.error.code === "THREAD_BUSY") {
    const settled = await changeThreadFrom(env.ctx, thread.id, ["landing"], {
      pullRequest: merged,
      status: { status: "ready-for-review" },
    });
    return { success: true as const, thread: settled.thread ?? thread };
  }
  logger.warn("Thread {threadId} merged but its checkout was not cleaned up: {error}", {
    threadId: thread.id,
    error: released.error.message,
  });
  return failure({
    code: "WORKTREE_FAILED",
    message: `The pull request merged, but cleaning up the checkout failed (${released.error.message}); merge again to retry`,
  });
};

const reload = async (env: PullRequestEnv, thread: Thread): Promise<Thread> =>
  (await env.ctx.threadRepository.getById(thread.id)) ?? thread;

const LANDABLE: readonly ThreadStatus[] = [
  "idle",
  "ready-for-review",
  "waiting-on-you",
  "resolved",
];

/**
 * Puts the thread in `landing` unless a turn has started since it was read; returns the thread as
 * it was, for putting it back. Refused as busy when it is working.
 */
export const markLanding = async (env: PullRequestEnv, threadId: string) => {
  const marked = await changeThreadFrom(env.ctx, threadId, LANDABLE, {
    status: { status: "landing" },
  });
  if (!marked.previous) return failure({ code: "THREAD_NOT_FOUND" });
  return marked.applied ? { previous: marked.previous } : failure({ code: "THREAD_BUSY" });
};

/** Puts a thread that a refused merge left in `landing` back, unless something has moved it since. */
export const abandonLanding = async (env: PullRequestEnv, previous: Thread) => {
  await changeThreadFrom(env.ctx, previous.id, ["landing"], { status: restingStatus(previous) });
};
