import { existsSync } from "node:fs";
import type { PullRequestRef, Thread } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { defaultRunGh, type RunGh } from "../github-cli/index.ts";
import { resolveDefaultBranch } from "../session-git/git-helpers.ts";
import {
  type CreateSessionPullRequestOptions,
  createSessionPullRequest,
  type GenerateSessionPrDraft,
} from "../session-git/pull-request.ts";
import { defaultRunGit, type RunGit, stageAndCommitChanges } from "../session-git/service.ts";
import { changeThreadFrom } from "./change.ts";
import type { ThreadCheckout } from "./checkout.ts";
import { createKeyedQueue } from "./keyed-queue.ts";
import {
  type MergePullRequestInput,
  mergeThreadPullRequest,
  syncThreadPullRequest,
} from "./pull-request-landing.ts";
import {
  failure,
  loadTarget,
  type PullRequestEnv,
  pullRequestFailure,
  type Target,
} from "./pull-request-support.ts";
import { pullRequestOf } from "./state.ts";
import type { ThreadResult } from "./types.ts";

export type { MergePullRequestInput } from "./pull-request-landing.ts";

export interface ThreadPullRequestDeps {
  runGit?: RunGit;
  runGh?: RunGh;
  /** Writes the title and body of a pull request the caller gave none for; tests stub it. */
  generateDraft?: GenerateSessionPrDraft;
  createProviderFn?: CreateSessionPullRequestOptions["createProviderFn"];
}

export interface OpenPullRequestInput {
  draft?: boolean;
  /** Skips the runtime-written draft: the thread's own account of its work. */
  title?: string;
  body?: string;
}

type Opened = ThreadResult<{ thread: Thread; pullRequest: PullRequestRef; created: boolean }>;

/**
 * A thread's pull request. A thread has at most one, and a pull request belongs to one thread:
 * its branch is the thread's alone. Every operation reads what GitHub says before it acts, so
 * running one again after a crash finishes the work instead of repeating it. Calls for one
 * thread run one at a time.
 */
export interface ThreadPullRequests {
  /** Commits and pushes the thread's branch and opens its pull request; a thread that has one gets it back. */
  openPullRequest: (threadId: string, input?: OpenPullRequestInput) => Promise<Opened>;
  /** Merges the pull request; once merged the thread is resolved and its worktree and branch are gone. */
  mergePullRequest: (
    threadId: string,
    input?: MergePullRequestInput,
  ) => Promise<ThreadResult<{ thread: Thread }>>;
  /** Brings the thread in line with the pull request as GitHub has it now. */
  syncPullRequest: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
}

export const createThreadPullRequests = (
  ctx: LocalServerContext,
  checkout: ThreadCheckout,
  deps: ThreadPullRequestDeps = {},
): ThreadPullRequests => {
  const env: PullRequestEnv = {
    ctx,
    checkout,
    runGit: deps.runGit ?? defaultRunGit,
    runGh: deps.runGh ?? defaultRunGh,
  };
  const queue = createKeyedQueue();
  return {
    openPullRequest: (threadId, input = {}) =>
      queue(threadId, () => openThreadPullRequest(env, deps, threadId, input)),
    mergePullRequest: (threadId, input = {}) =>
      queue(threadId, () => mergeThreadPullRequest(env, threadId, input)),
    syncPullRequest: (threadId) => queue(threadId, () => syncThreadPullRequest(env, threadId)),
  };
};

const openThreadPullRequest = async (
  env: PullRequestEnv,
  deps: ThreadPullRequestDeps,
  threadId: string,
  input: OpenPullRequestInput,
): Promise<Opened> => {
  // A thread opens its own pull request from inside its turn, so a working thread is not refused.
  const found = await loadTarget(env, threadId, { active: true });
  if ("error" in found) return failure(found.error);
  const { thread, repo } = found;
  const existing = pullRequestOf(thread);
  if (existing) return openExisting(env, found, existing);

  const ready = await env.checkout.provision(thread);
  if (!ready.success) return ready;
  if (!(await hasWorkToPublish(env.runGit, aopPaths.worktree(repo.id, thread.id)))) {
    return failure({ code: "NOTHING_TO_PUBLISH" });
  }

  const created = await createSessionPullRequest(
    env.ctx,
    thread.id,
    { mode: input.draft ? "draft" : "create" },
    env.runGh,
    env.runGit,
    {
      generateDraft: givenDraft(input, thread.title) ?? deps.generateDraft,
      createProviderFn: deps.createProviderFn,
    },
  );
  if (!created.success) return failure(pullRequestFailure(created.error));
  if (!("number" in created.result)) {
    const message = "GitHub returned no pull request";
    return failure(pullRequestFailure({ code: "PR_CREATE_FAILED", message }));
  }

  const { number, url } = created.result;
  const pullRequest = { number, url, state: "open" as const };
  return {
    success: true,
    thread: await recordOpened(env.ctx, thread, pullRequest),
    pullRequest,
    created: created.result.created,
  };
};

// A thread has one pull request. Asking again for one that is open sends what the thread did since,
// so it carries it; one that merged or closed is done, and further work belongs in a new thread.
const openExisting = async (
  env: PullRequestEnv,
  target: Target,
  existing: PullRequestRef,
): Promise<Opened> => {
  if (existing.state === "merged") return failure({ code: "PULL_REQUEST_MERGED" });
  if (existing.state === "closed") return failure({ code: "PULL_REQUEST_CLOSED" });
  const { thread, repo, branch } = target;
  const worktree = aopPaths.worktree(repo.id, thread.id);
  if (existsSync(worktree)) {
    const committed = await stageAndCommitChanges(env.runGit, worktree, thread.title);
    if (!committed.ok) return failure(pullRequestFailure(committed.error));
  }
  const pushed = await env.runGit(["push", "-u", "origin", branch], repo.path);
  if (pushed.exitCode !== 0) {
    const message = pushed.stderr.trim() || "git push failed";
    return failure(pullRequestFailure({ code: "PUSH_FAILED", message }));
  }
  return { success: true, thread, pullRequest: existing, created: false };
};

// An idle thread with a pull request open is waiting for review; one still working or asking
// something keeps its status, and the status is read when the change is made, not before the
// pull request took its time to open.
const recordOpened = async (
  ctx: LocalServerContext,
  thread: Thread,
  pullRequest: PullRequestRef,
): Promise<Thread> => {
  const changed = await changeThreadFrom(ctx, thread.id, ["idle"], {
    pullRequest,
    status: { status: "ready-for-review" },
    lastActivityAt: new Date().toISOString(),
  });
  return changed.thread ?? thread;
};

const givenDraft = (
  input: OpenPullRequestInput,
  threadTitle: string,
): GenerateSessionPrDraft | null =>
  input.title || input.body
    ? async () => ({
        title: input.title?.trim() || threadTitle,
        body: input.body?.trim() || "Opened from an AOP thread.",
      })
    : null;

// A pull request needs commits on the branch; gh refuses an empty one with an error that says little.
const hasWorkToPublish = async (runGit: RunGit, workspace: string): Promise<boolean> => {
  const status = await runGit(["status", "--porcelain"], workspace);
  if (status.exitCode !== 0 || status.stdout.trim()) return true;
  const base = await resolveDefaultBranch(runGit, workspace);
  if (!base) return true;
  const ahead = await runGit(["rev-list", "--count", `${base}..HEAD`], workspace);
  return ahead.exitCode !== 0 || Number.parseInt(ahead.stdout.trim(), 10) > 0;
};
