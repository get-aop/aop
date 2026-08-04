import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { defaultRunGh, type RunGh } from "../github-cli/index.ts";
import {
  type ListSessionGitBranchesResult,
  listSessionGitBranches,
  type SwitchSessionGitBranchServiceResult,
  switchSessionGitBranch,
} from "./branches.ts";
import {
  type GetSessionGitDiffResult,
  getSessionGitDiffFile,
  getSessionGitDiffSummary,
} from "./diff.ts";
import {
  type CreateSessionPrMode,
  type CreateSessionPullRequestResult,
  createSessionPullRequest,
  type MergeSessionPrMethod,
  type MergeSessionPullRequestResult,
  mergeSessionPullRequest,
} from "./pull-request.ts";
import {
  type GetSessionPullRequestStatusResult,
  getSessionPullRequestState,
  getSessionPullRequestStatus,
} from "./pull-request-status.ts";
import {
  type CommitSessionChangesResult,
  commitSessionChanges,
  defaultRunGit,
  type GetSessionGitStatusResult,
  getSessionGitStatus,
  type RunGit,
} from "./service.ts";
import { type CreateSessionWorktreeResult, createSessionWorktree } from "./worktree.ts";

export interface SessionGitRouteDeps {
  runGh?: RunGh;
  runGit?: RunGit;
}

const PR_MODES: readonly CreateSessionPrMode[] = ["create", "draft", "manual"];
const MERGE_METHODS: readonly MergeSessionPrMethod[] = ["squash", "merge", "rebase"];

export const createSessionGitRoutes = (ctx: LocalServerContext, deps: SessionGitRouteDeps = {}) => {
  const runGh = deps.runGh ?? defaultRunGh;
  const runGit = deps.runGit ?? defaultRunGit;
  const routes = new Hono();

  routes.get("/:sessionId/git/branches", async (c) => {
    const result = await listSessionGitBranches(ctx, c.req.param("sessionId"), runGit);
    if (!result.success) return mapBranchError(c, result);
    return c.json(result.result);
  });

  routes.post("/:sessionId/git/branch", async (c) => {
    const body = await c.req.json<{ branch?: unknown }>().catch(() => ({}) as { branch?: unknown });
    if (typeof body.branch !== "string" || !body.branch.trim()) {
      return c.json({ code: "INVALID_BRANCH", message: "branch must be a string" }, 400);
    }
    const result = await switchSessionGitBranch(ctx, c.req.param("sessionId"), body.branch, runGit);
    if (!result.success) return mapBranchError(c, result);
    return c.json(result.result);
  });

  routes.get("/:sessionId/git/status", async (c) => {
    const result = await getSessionGitStatus(ctx, c.req.param("sessionId"), runGit, runGh);
    if (!result.success) return mapStatusError(c, result);
    return c.json(result.status);
  });

  routes.post("/:sessionId/git/commit", async (c) => {
    const body = await c.req.json<{ push?: unknown }>().catch(() => ({}) as { push?: unknown });
    if (body.push !== undefined && typeof body.push !== "boolean") {
      return c.json({ code: "INVALID_PUSH", message: "push must be a boolean" }, 400);
    }
    const result = await commitSessionChanges(
      ctx,
      c.req.param("sessionId"),
      { push: body.push === true },
      runGit,
    );
    if (!result.success) return mapCommitError(c, result);
    return c.json(result.result);
  });

  routes.post("/:sessionId/git/pr", async (c) => {
    const body = await c.req.json<{ mode?: unknown }>().catch(() => ({}) as { mode?: unknown });
    const mode = body.mode;
    if (!PR_MODES.includes(mode as CreateSessionPrMode)) {
      return c.json(
        { code: "INVALID_MODE", message: "mode must be create, draft, or manual" },
        400,
      );
    }
    const result = await createSessionPullRequest(
      ctx,
      c.req.param("sessionId"),
      { mode: mode as CreateSessionPrMode },
      runGh,
      runGit,
    );
    if (!result.success) return mapPrError(c, result.error);
    if ("compareUrl" in result.result) return c.json(result.result);
    return c.json(result.result, result.result.created ? 201 : 200);
  });

  routes.get("/:sessionId/git/pr/state", async (c) => {
    const result = await getSessionPullRequestState(ctx, c.req.param("sessionId"), runGh, runGit);
    if (!result.success) return mapPrError(c, result.error);
    return c.json(result.status);
  });

  routes.get("/:sessionId/git/pr/status", async (c) => {
    const result = await getSessionPullRequestStatus(ctx, c.req.param("sessionId"), runGh, runGit);
    if (!result.success) return mapPrError(c, result.error);
    return c.json(result.status);
  });

  routes.post("/:sessionId/git/pr/merge", async (c) => {
    const body = await c.req.json<{ method?: unknown }>().catch(() => ({}) as { method?: unknown });
    const method = body.method;
    if (method !== undefined && !MERGE_METHODS.includes(method as MergeSessionPrMethod)) {
      return c.json(
        { code: "INVALID_METHOD", message: "method must be squash, merge, or rebase" },
        400,
      );
    }
    const result = await mergeSessionPullRequest(
      ctx,
      c.req.param("sessionId"),
      { method: method as MergeSessionPrMethod | undefined },
      runGh,
      runGit,
    );
    if (!result.success) return mapPrError(c, result.error);
    return c.json(result.status);
  });

  // Summary-only: path list + stats, no hunks (fast for 500+ files).
  routes.get("/:sessionId/git/diff", async (c) => {
    const result = await getSessionGitDiffSummary(ctx, c.req.param("sessionId"), runGit);
    if (!result.success) return mapDiffError(c, result);
    return c.json(result.diff);
  });

  // Per-file hunk body for an expanded row.
  routes.get("/:sessionId/git/diff/file", async (c) => {
    const path = c.req.query("path") ?? "";
    const result = await getSessionGitDiffFile(ctx, c.req.param("sessionId"), path, runGit);
    if (!result.success) {
      if (result.error.code === "PATH_REQUIRED") {
        return c.json({ code: "PATH_REQUIRED", error: "path query is required" }, 400);
      }
      if (result.error.code === "FILE_NOT_FOUND") {
        return c.json({ code: "FILE_NOT_FOUND", error: "No diff for that path" }, 404);
      }
      return mapDiffError(c, result as Extract<GetSessionGitDiffResult, { success: false }>);
    }
    return c.json(result.file);
  });

  routes.post("/:sessionId/worktree", async (c) => {
    const body = await c.req
      .json<{ branchName?: unknown; baseBranch?: unknown }>()
      .catch(() => ({}) as { branchName?: unknown; baseBranch?: unknown });
    const result = await createSessionWorktree(ctx, c.req.param("sessionId"), {
      branchName: typeof body.branchName === "string" ? body.branchName : undefined,
      baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : undefined,
    });
    if (!result.success) return mapWorktreeError(c, result);
    return c.json(
      {
        worktree: result.worktree,
        session: result.session,
      },
      201,
    );
  });

  return routes;
};

type WorkspaceBindingRouteError = {
  code: "WORKSPACE_BINDING_ERROR";
  message: string;
  path: string | null;
  resettable: boolean;
};

const mapWorkspaceBindingError = (c: Context, error: WorkspaceBindingRouteError) =>
  c.json(
    {
      code: error.code,
      error: error.message,
      path: error.path,
      resettable: error.resettable,
    },
    409,
  );

const mapNotFound = (c: Context) => c.json({ error: "Session not found" }, 404);

/** Errors shared by every session-git route; null when the error is route-specific. */
const mapCommonError = (c: Context, error: { code: string }): Response | null => {
  switch (error.code) {
    case "SESSION_NOT_FOUND":
      return mapNotFound(c);
    case "WORKSPACE_BINDING_ERROR":
      return mapWorkspaceBindingError(c, error as WorkspaceBindingRouteError);
    default:
      return null;
  }
};

type SessionBranchRouteError =
  | Extract<ListSessionGitBranchesResult, { success: false }>["error"]
  | Extract<SwitchSessionGitBranchServiceResult, { success: false }>["error"];

const mapBranchError = (c: Context, result: { success: false; error: SessionBranchRouteError }) => {
  const common = mapCommonError(c, result.error);
  if (common) return common;
  const status =
    result.error.code === "INVALID_BRANCH"
      ? 400
      : result.error.code === "BRANCH_NOT_FOUND"
        ? 404
        : result.error.code === "GIT_FAILED"
          ? 502
          : 409;
  const message = "message" in result.error ? result.error.message : "Branch request failed";
  return c.json({ code: result.error.code, message }, status);
};

const mapStatusError = (
  c: Context,
  result: Extract<GetSessionGitStatusResult, { success: false }>,
) => mapCommonError(c, result.error) ?? c.json({ error: "Unexpected git status error" }, 500);

const mapDiffError = (c: Context, result: Extract<GetSessionGitDiffResult, { success: false }>) =>
  mapCommonError(c, result.error) ?? c.json({ error: "Unexpected git diff error" }, 500);

const mapCommitError = (
  c: Context,
  result: Extract<CommitSessionChangesResult, { success: false }>,
) => {
  const common = mapCommonError(c, result.error);
  if (common) return common;
  const status =
    result.error.code === "PUSH_FAILED" || result.error.code === "GIT_FAILED" ? 502 : 409;
  const message =
    "message" in result.error
      ? result.error.message
      : result.error.code === "NO_CHANGES"
        ? "Nothing to commit"
        : "Commit failed";
  return c.json({ code: result.error.code, message }, status);
};

type SessionPrRouteError =
  | Extract<CreateSessionPullRequestResult, { success: false }>["error"]
  | Extract<GetSessionPullRequestStatusResult, { success: false }>["error"]
  | Extract<MergeSessionPullRequestResult, { success: false }>["error"];

const PR_ERROR_STATUS: Record<string, 400 | 409 | 502 | 503> = {
  NOT_A_GIT_REPO: 409,
  ON_DEFAULT_BRANCH: 409,
  DIRTY_MAIN_CHECKOUT: 409,
  NO_OPEN_PR: 409,
  CHECKS_FAILING: 409,
  NOT_MERGEABLE: 409,
  GH_UNAVAILABLE: 503,
  PUSH_FAILED: 502,
  PR_CREATE_FAILED: 502,
  MERGE_FAILED: 502,
};

const PR_ERROR_MESSAGE: Record<string, string> = {
  ON_DEFAULT_BRANCH: "Create a worktree first",
  NO_OPEN_PR: "No open pull request for this session branch",
};

const mapPrError = (c: Context, error: SessionPrRouteError) => {
  const common = mapCommonError(c, error);
  if (common) return common;
  const status = PR_ERROR_STATUS[error.code] ?? 500;
  const message =
    PR_ERROR_MESSAGE[error.code] ??
    ("message" in error ? error.message : "Pull request request failed");
  return c.json({ code: error.code, message }, status);
};

const mapWorktreeError = (
  c: Context,
  result: Extract<CreateSessionWorktreeResult, { success: false }>,
) => {
  const common = mapCommonError(c, result.error);
  if (common) return common;
  switch (result.error.code) {
    case "NOT_A_GIT_REPO":
    case "BRANCH_EXISTS":
    case "WORKTREE_EXISTS":
    case "BASE_BRANCH_NOT_FOUND":
    case "INVALID_BRANCH_NAME":
      return c.json({ code: result.error.code, error: result.error.message }, 409);
  }
};
