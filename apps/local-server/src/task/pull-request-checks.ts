import { getLogger } from "@aop/infra";
import { defaultGitRunner, type RunCommand } from "../command-runner.ts";
import type { LocalServerContext } from "../context.ts";
import { resolveTaskBranchName } from "./branch-name.ts";
import {
  defaultRunGh,
  findPullRequestByHead,
  type GhPullRequestRef,
  isGhAuthenticated,
  listPullRequestChecks,
  type RunGh,
  summarizePullRequestChecks,
} from "./pr-github.ts";

const logger = getLogger("task", "pull-request-checks");

export type TaskPullRequestStatusResult =
  | {
      success: true;
      branchName: string;
      hasPullRequest: boolean;
      pullRequestUrl: string | null;
      pullRequestNumber: number | null;
      pullRequestState: string | null;
      baseRefName: string | null;
      needsBranchUpdate: boolean;
      baseBehindCount: number;
      checksState: "pending" | "success" | "failure" | null;
    }
  | { success: false; error: { code: "NOT_FOUND" } | { code: "GH_UNAVAILABLE"; message: string } };

export type RunGit = RunCommand;

interface BranchUpdateStatus {
  baseRefName: string | null;
  needsBranchUpdate: boolean;
  baseBehindCount: number;
}

const defaultRunGit: RunGit = defaultGitRunner;

const resolveTaskPullRequestContext = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<
  | { ok: false; error: { code: "NOT_FOUND" } | { code: "GH_UNAVAILABLE"; message: string } }
  | {
      ok: true;
      branchName: string;
      repoPath: string;
    }
> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    return { ok: false, error: { code: "NOT_FOUND" } };
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    return { ok: false, error: { code: "NOT_FOUND" } };
  }

  if (!(await isGhAuthenticated())) {
    return {
      ok: false,
      error: {
        code: "GH_UNAVAILABLE",
        message: "GitHub CLI (gh) is not installed or not authenticated",
      },
    };
  }

  return {
    ok: true,
    branchName: resolveTaskBranchName(task),
    repoPath: repo.path,
  };
};

/** Read-only PR status for Pool cards. */
export const getTaskPullRequestStatus = async (
  ctx: LocalServerContext,
  taskId: string,
  runGh: RunGh = defaultRunGh,
  runGit: RunGit = defaultRunGit,
): Promise<TaskPullRequestStatusResult> => {
  const context = await resolveTaskPullRequestContext(ctx, taskId);
  if (!context.ok) {
    return { success: false, error: context.error };
  }

  const pullRequest = await findPullRequestByHead(runGh, context.repoPath, context.branchName);
  const checks = pullRequest
    ? summarizePullRequestChecks(
        await listPullRequestChecks(runGh, context.repoPath, context.branchName),
      )
    : null;
  const branchUpdate = await getBranchUpdateStatus(
    runGit,
    context.repoPath,
    context.branchName,
    pullRequest,
  );

  return {
    success: true,
    branchName: context.branchName,
    hasPullRequest: pullRequest !== null,
    pullRequestUrl: pullRequest?.url ?? null,
    pullRequestNumber: pullRequest?.number ?? null,
    pullRequestState: pullRequest?.state ?? null,
    baseRefName: branchUpdate.baseRefName,
    needsBranchUpdate: branchUpdate.needsBranchUpdate,
    baseBehindCount: branchUpdate.baseBehindCount,
    checksState: checks?.state ?? null,
  };
};

const getBranchUpdateStatus = async (
  runGit: RunGit,
  repoPath: string,
  branchName: string,
  pullRequest: GhPullRequestRef | null,
): Promise<BranchUpdateStatus> => {
  const baseRefName = pullRequest?.baseRefName ?? null;
  if (pullRequest?.state !== "OPEN" || !baseRefName) {
    return { baseRefName, needsBranchUpdate: false, baseBehindCount: 0 };
  }

  const headRefName = pullRequest.headRefName ?? branchName;
  const baseRemoteRef = `refs/remotes/origin/${baseRefName}`;
  const headRemoteRef = `refs/remotes/origin/${headRefName}`;
  const fetchResult = await runGit(
    [
      "fetch",
      "origin",
      `${baseRefName}:${baseRemoteRef}`,
      `${headRefName}:${headRemoteRef}`,
      "--quiet",
    ],
    repoPath,
  );
  if (fetchResult.exitCode !== 0) {
    logger.warn("Could not fetch pull request refs for status: {error}", {
      error: fetchResult.stderr.trim() || fetchResult.stdout.trim(),
    });
    return { baseRefName, needsBranchUpdate: false, baseBehindCount: 0 };
  }

  const behindResult = await runGit(
    ["rev-list", "--count", `${headRemoteRef}..${baseRemoteRef}`],
    repoPath,
  );
  if (behindResult.exitCode !== 0) {
    return { baseRefName, needsBranchUpdate: false, baseBehindCount: 0 };
  }

  const baseBehindCount = Number.parseInt(behindResult.stdout.trim(), 10);
  const safeBaseBehindCount = Number.isFinite(baseBehindCount) ? baseBehindCount : 0;
  return {
    baseRefName,
    needsBranchUpdate: safeBaseBehindCount > 0,
    baseBehindCount: safeBaseBehindCount,
  };
};
