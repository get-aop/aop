import type { LocalServerContext } from "../context.ts";
import { createThreadCheckout, type ThreadCheckout } from "./checkout.ts";
import { createThreadLifecycle, type ThreadLifecycle } from "./lifecycle.ts";
import {
  createThreadPullRequests,
  type ThreadPullRequestDeps,
  type ThreadPullRequests,
} from "./pull-request.ts";

/** Everything git does for a thread: its worktree, its pull request, and the end of its life. */
export interface ThreadGit extends ThreadCheckout, ThreadPullRequests, ThreadLifecycle {}

/** The seams tests use to keep git, GitHub and the runtime that writes pull requests off the network. */
export type ThreadGitDeps = ThreadPullRequestDeps;

export const createThreadGit = (ctx: LocalServerContext, deps: ThreadGitDeps = {}): ThreadGit => {
  const checkout = createThreadCheckout(ctx, deps);
  const pullRequests = createThreadPullRequests(ctx, checkout, deps);
  return {
    ...checkout,
    ...pullRequests,
    ...createThreadLifecycle(ctx, checkout, pullRequests),
  };
};
