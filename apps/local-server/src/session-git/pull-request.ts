import type { CreateSessionPrMode, CreateSessionPrResult, MergeSessionPrMethod } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import {
  defaultRunGh,
  findPullRequestByHead,
  mergePullRequest,
  type RunGh,
  repoNameWithOwnerFromUrl,
  viewPullRequest,
} from "../github-cli/index.ts";
import {
  checkGhAvailable,
  resolveSessionPrContext,
  type SessionPrPreconditionError,
} from "./pull-request-context.ts";
import {
  type GetSessionPullRequestStatusResult,
  getSessionPullRequestStatus,
  type SessionPullRequestStatus,
} from "./pull-request-status.ts";
import { defaultRunGit, isLinkedWorktree, type RunGit, stageAndCommitChanges } from "./service.ts";

export type { CreateSessionPrMode, CreateSessionPrResult, MergeSessionPrMethod } from "@aop/common";

export type CreateSessionPullRequestResult =
  | { success: true; result: CreateSessionPrResult }
  | {
      success: false;
      error:
        | SessionPrPreconditionError
        | { code: "ON_DEFAULT_BRANCH" }
        | { code: "DIRTY_MAIN_CHECKOUT"; message: string }
        | { code: "GH_UNAVAILABLE"; message: string }
        | { code: "PUSH_FAILED"; message: string }
        | { code: "PR_CREATE_FAILED"; message: string };
    };

/** Push the session branch and open (or link to) a GitHub pull request. */
export const createSessionPullRequest = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: { mode: CreateSessionPrMode },
  runGh: RunGh = defaultRunGh,
  runGit: RunGit = defaultRunGit,
): Promise<CreateSessionPullRequestResult> => {
  const resolved = await resolveSessionPrContext(ctx, sessionId, runGit);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }
  const { workspace, branch, defaultBranch, sessionTitle } = resolved.context;

  if (!branch || !defaultBranch || branch === defaultBranch) {
    return { success: false, error: { code: "ON_DEFAULT_BRANCH" } };
  }
  const context: ReadySessionPrContext = { workspace, branch, defaultBranch, sessionTitle };

  const gh = await checkGhAvailable(runGh, workspace);
  if (!gh.ok) {
    return { success: false, error: { code: "GH_UNAVAILABLE", message: gh.message } };
  }

  const existing = await findPullRequestByHead(runGh, workspace, branch);
  if (existing && existing.state === "OPEN") {
    return {
      success: true,
      result: { number: existing.number, url: existing.url, state: "OPEN", created: false },
    };
  }

  const committed = await commitPendingChanges(runGit, context);
  if (!committed.ok) {
    return { success: false, error: commitFailureError(committed) };
  }

  return pushAndCreate(runGh, runGit, context, input.mode);
};

const commitFailureError = (
  committed: Extract<Awaited<ReturnType<typeof commitPendingChanges>>, { ok: false }>,
): Extract<CreateSessionPullRequestResult, { success: false }>["error"] =>
  committed.code === "DIRTY_MAIN_CHECKOUT"
    ? { code: "DIRTY_MAIN_CHECKOUT", message: committed.message }
    : { code: "PUSH_FAILED", message: committed.message };

const pushAndCreate = async (
  runGh: RunGh,
  runGit: RunGit,
  context: ReadySessionPrContext,
  mode: CreateSessionPrMode,
): Promise<CreateSessionPullRequestResult> => {
  const push = await runGit(["push", "-u", "origin", context.branch], context.workspace);
  if (push.exitCode !== 0) {
    return {
      success: false,
      error: { code: "PUSH_FAILED", message: push.stderr.trim() || "git push failed" },
    };
  }

  if (mode === "manual") {
    return buildManualCompareResult(runGit, context);
  }

  return runPrCreate(runGh, context, mode);
};

export type MergeSessionPullRequestResult =
  | Extract<GetSessionPullRequestStatusResult, { success: true }>
  | {
      success: false;
      error:
        | SessionPrPreconditionError
        | { code: "GH_UNAVAILABLE"; message: string }
        | { code: "NO_OPEN_PR" }
        | { code: "CHECKS_FAILING"; message: string }
        | { code: "NOT_MERGEABLE"; message: string }
        | { code: "MERGE_FAILED"; message: string };
    };

// Keep required-check failures distinct, and classify mergeability only from
// precise phrases; broad /review|check/ matching previously hid generic errors.
const CHECKS_FAILING_PATTERN =
  /required status check|status checks? (?:has|have) not passed|failing status checks?/i;
const NOT_MERGEABLE_PATTERN = /not mergeable|merge conflict|required review/i;

export interface MergeSessionPullRequestOptions {
  /** Post-merge confirmation polling; tests inject 0ms / 1 attempt. */
  confirmAttempts?: number;
  confirmDelayMs?: number;
}

/** Merge the session branch's open PR via gh, then return the refreshed PR status. */
export const mergeSessionPullRequest = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: { method?: MergeSessionPrMethod },
  runGh: RunGh = defaultRunGh,
  runGit: RunGit = defaultRunGit,
  options: MergeSessionPullRequestOptions = {},
): Promise<MergeSessionPullRequestResult> => {
  const resolved = await resolveSessionPrContext(ctx, sessionId, runGit);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }
  const { workspace, branch } = resolved.context;

  const gh = await checkGhAvailable(runGh, workspace);
  if (!gh.ok) {
    return { success: false, error: { code: "GH_UNAVAILABLE", message: gh.message } };
  }

  const pullRequest = branch ? await findPullRequestByHead(runGh, workspace, branch) : null;
  if (pullRequest?.state !== "OPEN") {
    return { success: false, error: { code: "NO_OPEN_PR" } };
  }

  const method = input.method ?? "squash";
  const merge = await mergePullRequest(runGh, workspace, pullRequest.number, {
    method,
    deleteBranch: false,
  });
  if (!merge.ok) {
    return { success: false, error: mergeFailureError(merge.message) };
  }

  // The merge already succeeded; a lagging status read must never turn this
  // into a reported failure. Confirm via `pr view`, then fall back to a full
  // refresh that may briefly still show the pre-merge state.
  const confirmed = await confirmMergedStatus(
    runGh,
    workspace,
    pullRequest.number,
    branch ?? "",
    options.confirmAttempts ?? 4,
    options.confirmDelayMs ?? 400,
  );
  if (confirmed) return { success: true, status: confirmed };
  return getSessionPullRequestStatus(ctx, sessionId, runGh, runGit);
};

const mergeFailureError = (
  message: string,
): Extract<MergeSessionPullRequestResult, { success: false }>["error"] => {
  if (CHECKS_FAILING_PATTERN.test(message)) return { code: "CHECKS_FAILING", message };
  if (NOT_MERGEABLE_PATTERN.test(message)) return { code: "NOT_MERGEABLE", message };
  return { code: "MERGE_FAILED", message };
};

const confirmMergedStatus = async (
  runGh: RunGh,
  workspace: string,
  pullRequestNumber: number,
  branch: string,
  attempts: number,
  delayMs: number,
): Promise<SessionPullRequestStatus | null> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await viewPullRequest(runGh, workspace, pullRequestNumber);
    if (result.ok && result.view.state === "MERGED") {
      return mergedStatusFromView(result.view, branch);
    }
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  return null;
};

const mergedStatusFromView = (
  view: {
    number: number;
    url: string;
    title: string;
    authorLogin: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    mergedAt: string | null;
    baseRefName: string | null;
    headRefName: string | null;
  },
  branch: string,
): SessionPullRequestStatus => ({
  pr: {
    number: view.number,
    url: view.url,
    title: view.title,
    state: "MERGED",
    mergeable: "",
    baseRefName: view.baseRefName ?? "",
    headRefName: view.headRefName ?? branch,
  },
  checksState: null,
  checks: [],
  merged: {
    number: view.number,
    url: view.url,
    title: view.title,
    authorLogin: view.authorLogin,
    additions: view.additions,
    deletions: view.deletions,
    changedFiles: view.changedFiles,
    mergedAt: view.mergedAt,
    repoNameWithOwner: repoNameWithOwnerFromUrl(view.url),
  },
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** SessionPrContext narrowed after the ON_DEFAULT_BRANCH guard. */
interface ReadySessionPrContext {
  workspace: string;
  branch: string;
  defaultBranch: string;
  sessionTitle: string;
}

const commitPendingChanges = async (
  runGit: RunGit,
  context: ReadySessionPrContext,
): Promise<
  { ok: true } | { ok: false; code: "DIRTY_MAIN_CHECKOUT" | "PUSH_FAILED"; message: string }
> => {
  const status = await runGit(["status", "--porcelain"], context.workspace);
  if (status.exitCode !== 0 || status.stdout.trim().length === 0) return { ok: true };

  // Auto-committing is only safe in a session-managed linked worktree. On the
  // user's main checkout a blanket `git add -A` would sweep up unrelated work.
  if (!(await isLinkedWorktree(runGit, context.workspace))) {
    return {
      ok: false,
      code: "DIRTY_MAIN_CHECKOUT",
      message: "Workspace has uncommitted changes — create a worktree first",
    };
  }

  const committed = await stageAndCommitChanges(runGit, context.workspace, context.sessionTitle);
  if (!committed.ok) return { ok: false, code: "PUSH_FAILED", message: committed.error.message };
  return { ok: true };
};

const buildManualCompareResult = async (
  runGit: RunGit,
  context: ReadySessionPrContext,
): Promise<CreateSessionPullRequestResult> => {
  const remote = await runGit(["remote", "get-url", "origin"], context.workspace);
  const repo = remote.exitCode === 0 ? parseGitHubRemote(remote.stdout.trim()) : null;
  if (!repo) {
    return {
      success: false,
      error: {
        code: "PR_CREATE_FAILED",
        message: "The origin remote is not a GitHub repository",
      },
    };
  }

  const compareUrl = `https://github.com/${repo.owner}/${repo.name}/compare/${context.defaultBranch}...${context.branch}?expand=1`;
  return { success: true, result: { compareUrl, created: false } };
};

const parseGitHubRemote = (url: string): { owner: string; name: string } | null => {
  const match =
    url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/) ??
    url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], name: match[2] };
};

const runPrCreate = async (
  runGh: RunGh,
  context: ReadySessionPrContext,
  mode: "create" | "draft",
): Promise<CreateSessionPullRequestResult> => {
  const title = context.sessionTitle.trim() || context.branch;
  const args = [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    "Created from an AOP chat session.",
    "--base",
    context.defaultBranch,
    "--head",
    context.branch,
  ];
  if (mode === "draft") args.push("--draft");

  const result = await runGh(args, context.workspace);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: {
        code: "PR_CREATE_FAILED",
        message: result.stderr.trim() || "gh pr create failed",
      },
    };
  }

  const url = extractPullRequestUrl(result.stdout);
  const number = url ? Number.parseInt(url.split("/").pop() ?? "", 10) : Number.NaN;
  if (!url || Number.isNaN(number)) {
    return {
      success: false,
      error: {
        code: "PR_CREATE_FAILED",
        message: "gh pr create did not return a pull request URL",
      },
    };
  }

  return { success: true, result: { number, url, state: "OPEN", created: true } };
};

const extractPullRequestUrl = (stdout: string): string | null => {
  const match = stdout.trim().match(/https:\/\/github\.com\/\S+\/pull\/\d+(?=\s|$)/g);
  return match?.at(-1) ?? null;
};
