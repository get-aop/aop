import type { SessionPullRequestStateStatus, SessionPullRequestStatus } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import {
  defaultRunGh,
  findPullRequestByHead,
  type GhPullRequestRef,
  listPullRequestChecksDetailed,
  type RunGh,
  repoNameWithOwnerFromUrl,
  summarizePullRequestChecks,
  viewPullRequest,
} from "../github-cli/index.ts";
import {
  checkGhAvailable,
  resolveSessionPrContext,
  type SessionPrPreconditionError,
} from "./pull-request-context.ts";
import { defaultRunGit, type RunGit } from "./service.ts";

export type { SessionPullRequestStatus } from "@aop/common";

export type GetSessionPullRequestStatusResult =
  | { success: true; status: SessionPullRequestStatus }
  | {
      success: false;
      error: SessionPrPreconditionError | { code: "GH_UNAVAILABLE"; message: string };
    };

export type GetSessionPullRequestStateResult =
  | { success: true; status: SessionPullRequestStateStatus }
  | {
      success: false;
      error: SessionPrPreconditionError | { code: "GH_UNAVAILABLE"; message: string };
    };

/** Lightweight PR state for sidebar settlement classification. */
export const getSessionPullRequestState = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGh: RunGh = defaultRunGh,
  runGit: RunGit = defaultRunGit,
): Promise<GetSessionPullRequestStateResult> => {
  const resolved = await resolveSessionPrContext(ctx, sessionId, runGit);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { workspace, branch, defaultBranch } = resolved.context;
  if (!branch || branch === defaultBranch) return { success: true, status: { state: null } };

  const gh = await checkGhAvailable(runGh, workspace);
  if (!gh.ok) {
    return { success: false, error: { code: "GH_UNAVAILABLE", message: gh.message } };
  }
  const pullRequest = await findPullRequestByHead(runGh, workspace, branch);
  return {
    success: true,
    status: { state: pullRequest ? pullRequestState(pullRequest.state) : null },
  };
};

const pullRequestState = (
  state: GhPullRequestRef["state"],
): NonNullable<SessionPullRequestStateStatus["state"]> => {
  if (state === "OPEN") return "open";
  if (state === "CLOSED") return "closed";
  return "merged";
};

/** PR status for the session workspace's current branch, via the GitHub CLI. */
export const getSessionPullRequestStatus = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGh: RunGh = defaultRunGh,
  runGit: RunGit = defaultRunGit,
): Promise<GetSessionPullRequestStatusResult> => {
  const resolved = await resolveSessionPrContext(ctx, sessionId, runGit);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }
  const { workspace, branch, defaultBranch } = resolved.context;

  if (!branch || branch === defaultBranch) {
    return { success: true, status: emptyStatus() };
  }

  const [gh, pullRequest] = await Promise.all([
    checkGhAvailable(runGh, workspace),
    findPullRequestByHead(runGh, workspace, branch),
  ]);
  if (!gh.ok) {
    return { success: false, error: { code: "GH_UNAVAILABLE", message: gh.message } };
  }

  if (!pullRequest) {
    return { success: true, status: emptyStatus() };
  }

  return buildStatusForPullRequest(runGh, workspace, branch, pullRequest);
};

const buildStatusForPullRequest = async (
  runGh: RunGh,
  workspace: string,
  branch: string,
  pullRequest: GhPullRequestRef,
): Promise<GetSessionPullRequestStatusResult> => {
  const status: SessionPullRequestStatus = {
    ...emptyStatus(),
    pr: {
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      state: pullRequest.state,
      mergeable: pullRequest.mergeable ?? "UNKNOWN",
      baseRefName: pullRequest.baseRefName ?? "",
      headRefName: pullRequest.headRefName ?? branch,
    },
  };

  if (pullRequest.state === "OPEN") {
    const detailed = await listPullRequestChecksDetailed(runGh, workspace, branch);
    status.checks = detailed.checks;
    // Repos without CI report no checks at all: null, not an eternal pending.
    status.checksState = detailed.reported
      ? summarizePullRequestChecks(detailed.checks).state
      : null;
    return { success: true, status };
  }

  if (pullRequest.state === "MERGED") {
    const merged = await readMergedDetail(runGh, workspace, pullRequest);
    if (!merged.ok) {
      return { success: false, error: { code: "GH_UNAVAILABLE", message: merged.message } };
    }
    status.merged = merged.detail;
  }

  return { success: true, status };
};

const emptyStatus = (): SessionPullRequestStatus => ({
  pr: null,
  checksState: null,
  checks: [],
  merged: null,
});

const readMergedDetail = async (
  runGh: RunGh,
  workspace: string,
  pullRequest: GhPullRequestRef,
): Promise<
  | { ok: true; detail: NonNullable<SessionPullRequestStatus["merged"]> }
  | { ok: false; message: string }
> => {
  const result = await viewPullRequest(runGh, workspace, pullRequest.number);
  if (!result.ok) return { ok: false, message: result.message };
  const { view } = result;

  return {
    ok: true,
    detail: {
      number: view.number,
      url: view.url,
      title: view.title,
      authorLogin: view.authorLogin,
      additions: view.additions,
      deletions: view.deletions,
      changedFiles: view.changedFiles,
      mergedAt: view.mergedAt,
      repoNameWithOwner: repoNameWithOwnerFromUrl(view.url || pullRequest.url),
    },
  };
};
