import type { PullRequestRef, Thread } from "@aop/common";
import { type MergeSessionPrMethod, mergeSessionPullRequest } from "../session-git/pull-request.ts";
import { changeThreadFrom } from "./change.ts";
import {
  abandonLanding,
  failure,
  hasUnpublishedWork,
  land,
  loadTarget,
  markLanding,
  type PullRequestEnv,
  pullRequestFailure,
  readPullRequest,
  restingStatus,
  stateOf,
  type Target,
} from "./pull-request-support.ts";
import { pullRequestOf } from "./state.ts";
import type { ThreadResult } from "./types.ts";

export interface MergePullRequestInput {
  method?: MergeSessionPrMethod;
}

type Landed = ThreadResult<{ thread: Thread }>;

/**
 * Merges the thread's pull request. GitHub is asked first, so a merge an earlier call made (or
 * one made on GitHub) is finished, not repeated.
 */
export const mergeThreadPullRequest = async (
  env: PullRequestEnv,
  threadId: string,
  input: MergePullRequestInput,
): Promise<Landed> => {
  const found = await loadTarget(env, threadId, { active: true, idle: true });
  if ("error" in found) return failure(found.error);
  const { thread, repo, branch } = found;
  const recorded = pullRequestOf(thread);
  if (!recorded) return failure({ code: "NO_PULL_REQUEST" });
  // Merged and not resolved: the thread was reopened after its merge. What it holds now is new
  // work for a new thread, and must not be cleaned up as if it were the merged branch.
  if (recorded.state === "merged" && thread.status !== "resolved") {
    return failure({ code: "PULL_REQUEST_MERGED" });
  }

  const current = await readPullRequest(env, repo, branch);
  if ("error" in current) return failure(current.error);
  const state = current.found ? stateOf(current.found) : recorded.state;
  if (state === "merged") return land(env, found, recorded);
  if (state === "closed") return failure({ code: "PULL_REQUEST_CLOSED" });
  return mergeOpenPullRequest(env, found, recorded, input);
};

const mergeOpenPullRequest = async (
  env: PullRequestEnv,
  target: Target,
  recorded: PullRequestRef,
  input: MergePullRequestInput,
): Promise<Landed> => {
  const { thread } = target;
  const ready = await env.checkout.provision(thread);
  if (!ready.success) return ready;
  // Only what is on GitHub gets merged, and the branch is deleted afterwards: work that never
  // reached the pull request would be lost, so the merge waits until it has been pushed.
  if (await hasUnpublishedWork(env, target)) return failure({ code: "UNPUBLISHED_WORK" });
  const marked = await markLanding(env, thread.id);
  if ("error" in marked) return failure(marked.error);

  const merged = await mergeSessionPullRequest(
    env.ctx,
    thread.id,
    { method: input.method },
    env.runGh,
    env.runGit,
  );
  if (!merged.success) {
    await abandonLanding(env, marked.previous);
    return failure(pullRequestFailure(merged.error));
  }
  if (merged.status.pr?.state === "MERGED") return land(env, target, recorded);
  // GitHub has not reported the merge yet; the thread stays landing until a sync finishes it.
  return { success: true, thread: (await env.ctx.threadRepository.getById(thread.id)) ?? thread };
};

/**
 * Brings the thread in line with its pull request as GitHub has it. Calls for a thread run one
 * at a time, so a thread found landing has no merge in flight: it was interrupted, and goes back
 * to waiting for review unless the merge did happen.
 */
export const syncThreadPullRequest = async (
  env: PullRequestEnv,
  threadId: string,
): Promise<Landed> => {
  const found = await loadTarget(env, threadId);
  if ("error" in found) return failure(found.error);
  const { thread, repo, branch } = found;
  const recorded = pullRequestOf(thread);
  if (!recorded) return failure({ code: "NO_PULL_REQUEST" });
  // Nothing more to learn from GitHub, and a thread reopened since must keep what it holds.
  if (recorded.state === "merged") return { success: true, thread };

  const current = await readPullRequest(env, repo, branch);
  if ("error" in current) return failure(current.error);
  if (!current.found) return { success: true, thread };
  const state = stateOf(current.found);
  if (state === "merged") return land(env, found, recorded);

  const stalled = thread.status === "landing";
  if (state === recorded.state && !stalled) return { success: true, thread };
  // Only a thread still landing is put back; a status something else has set since is left alone.
  const changed = await changeThreadFrom(env.ctx, thread.id, ["landing"], {
    pullRequest: { ...recorded, state },
    ...(stalled && { status: restingStatus(thread) }),
  });
  return { success: true, thread: changed.thread ?? thread };
};
