import type {
  SessionGitBranch,
  SessionGitBranchList,
  SwitchSessionGitBranchResult,
} from "@aop/common";
import { GitManager } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import {
  resolveSessionWorkspaceBinding,
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { resolveDefaultBranch } from "./git-helpers.ts";
import { defaultRunGit, isLinkedWorktree, type RunGit } from "./service.ts";

const logger = getLogger("session-git", "branches");

type SessionBranchError =
  | { code: "SESSION_NOT_FOUND" }
  | { code: "INVALID_BRANCH"; message: string }
  | { code: "BRANCH_NOT_FOUND"; message: string }
  | { code: "DIRTY_WORKSPACE"; message: string }
  | { code: "GIT_FAILED"; message: string }
  | {
      code: "WORKSPACE_BINDING_ERROR";
      message: string;
      path: string | null;
      resettable: boolean;
    };

export type ListSessionGitBranchesResult =
  | { success: true; result: SessionGitBranchList }
  | { success: false; error: SessionBranchError };

export type SwitchSessionGitBranchServiceResult =
  | { success: true; result: SwitchSessionGitBranchResult }
  | { success: false; error: SessionBranchError };

export const listSessionGitBranches = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGit: RunGit = defaultRunGit,
): Promise<ListSessionGitBranchesResult> => {
  const context = await resolveBranchContext(ctx, sessionId);
  if (!context.success) return context;

  const state = await readBranchState(runGit, context.context.workspacePath);
  if (!state.success) return state;
  return { success: true, result: { branches: state.branches } };
};

export const switchSessionGitBranch = async (
  ctx: LocalServerContext,
  sessionId: string,
  requestedBranch: string,
  runGit: RunGit = defaultRunGit,
): Promise<SwitchSessionGitBranchServiceResult> => {
  const branch = requestedBranch.trim();
  if (!branch) {
    return {
      success: false,
      error: { code: "INVALID_BRANCH", message: "Branch is required" },
    };
  }

  const context = await resolveBranchContext(ctx, sessionId);
  if (!context.success) return context;
  const state = await readBranchState(runGit, context.context.workspacePath);
  if (!state.success) return state;

  const selected = state.branches.find((candidate) => candidate.name === branch);
  if (!selected) {
    return {
      success: false,
      error: { code: "BRANCH_NOT_FOUND", message: `Branch not found: ${branch}` },
    };
  }
  if (selected.isCurrent) {
    return {
      success: true,
      result: { branch, workspacePath: context.context.workspacePath },
    };
  }

  return switchSelectedBranch({
    ctx,
    sessionId,
    branch,
    selected,
    context: context.context,
    worktreesByPath: state.worktreesByPath,
    runGit,
  });
};

interface BranchContext {
  session: ChatSession;
  repoId: string;
  repoPath: string;
  workspacePath: string;
}

const switchSelectedBranch = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  branch: string;
  selected: SessionGitBranch;
  context: BranchContext;
  worktreesByPath: Map<string, string>;
  runGit: RunGit;
}): Promise<SwitchSessionGitBranchServiceResult> => {
  const clean = await requireCleanWorkspace(input.runGit, input.context.workspacePath);
  if (!clean.success) return clean;
  if (input.selected.worktreePath) {
    return bindSelectedWorkspace(
      input.ctx,
      input.sessionId,
      input.branch,
      input.selected.worktreePath,
    );
  }

  const workspace = await resolveSwitchWorkspace(
    input.context,
    input.worktreesByPath,
    input.runGit,
  );
  if (!workspace.success) return workspace;
  if (workspace.create) return createBranchWorktree(input);

  const targetClean = await requireCleanWorkspace(input.runGit, workspace.path);
  if (!targetClean.success) return targetClean;
  const switched = await input.runGit(["switch", input.branch], workspace.path);
  if (switched.exitCode !== 0) {
    return {
      success: false,
      error: {
        code: "GIT_FAILED",
        message: switched.stderr.trim() || `Could not switch to ${input.branch}`,
      },
    };
  }
  return bindSelectedWorkspace(input.ctx, input.sessionId, input.branch, workspace.path);
};

const createBranchWorktree = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  branch: string;
  context: BranchContext;
}): Promise<SwitchSessionGitBranchServiceResult> => {
  try {
    const gitManager = new GitManager({
      repoPath: input.context.repoPath,
      repoId: input.context.repoId,
    });
    await gitManager.init();
    const worktree = await gitManager.createWorktree(input.sessionId, input.branch, input.branch);
    return bindSelectedWorkspace(input.ctx, input.sessionId, input.branch, worktree.path);
  } catch (error) {
    return gitFailure(error, `Could not create a worktree for ${input.branch}`);
  }
};

const resolveBranchContext = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<
  { success: true; context: BranchContext } | { success: false; error: SessionBranchError }
> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session?.repo_id) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const repo = await ctx.repoRepository.getById(session.repo_id);
  if (!repo) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  try {
    return {
      success: true,
      context: {
        session,
        repoId: repo.id,
        repoPath: repo.path,
        workspacePath: await resolveSessionWorkspaceBinding(ctx, session),
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) return workspaceBindingFailure(error);
    throw error;
  }
};

const readBranchState = async (
  runGit: RunGit,
  workspacePath: string,
): Promise<
  | {
      success: true;
      branches: SessionGitBranch[];
      worktreesByPath: Map<string, string>;
    }
  | { success: false; error: SessionBranchError }
> => {
  const [branchesResult, currentResult, defaultBranch, worktreesResult] = await Promise.all([
    runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], workspacePath),
    runGit(["branch", "--show-current"], workspacePath),
    resolveDefaultBranch(runGit, workspacePath),
    runGit(["worktree", "list", "--porcelain", "-z"], workspacePath),
  ]);
  if (branchesResult.exitCode !== 0 || currentResult.exitCode !== 0) {
    return {
      success: false,
      error: {
        code: "GIT_FAILED",
        message:
          branchesResult.stderr.trim() || currentResult.stderr.trim() || "Could not list branches",
      },
    };
  }
  if (worktreesResult.exitCode !== 0) {
    return {
      success: false,
      error: {
        code: "GIT_FAILED",
        message: worktreesResult.stderr.trim() || "Could not list worktrees",
      },
    };
  }

  const current = currentResult.stdout.trim();
  const worktrees = parseWorktrees(worktreesResult.stdout);
  const branches = branchesResult.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      isCurrent: name === current,
      isDefault: name === defaultBranch,
      worktreePath: worktrees.byBranch.get(name) ?? null,
    }))
    .sort(compareBranches);
  return { success: true, branches, worktreesByPath: worktrees.byPath };
};

const resolveSwitchWorkspace = async (
  context: BranchContext,
  worktreesByPath: Map<string, string>,
  runGit: RunGit,
): Promise<
  | { success: true; create: false; path: string }
  | { success: true; create: true }
  | { success: false; error: SessionBranchError }
> => {
  if (await isLinkedWorktree(runGit, context.workspacePath)) {
    return { success: true, create: false, path: context.workspacePath };
  }

  const managedPath = aopPaths.worktree(context.repoId, context.session.id);
  if (worktreesByPath.has(managedPath)) {
    return { success: true, create: false, path: managedPath };
  }
  return { success: true, create: true };
};

const requireCleanWorkspace = async (
  runGit: RunGit,
  workspacePath: string,
): Promise<{ success: true } | { success: false; error: SessionBranchError }> => {
  const status = await runGit(["status", "--porcelain"], workspacePath);
  if (status.exitCode !== 0) {
    return {
      success: false,
      error: { code: "GIT_FAILED", message: status.stderr.trim() || "Could not read Git status" },
    };
  }
  if (status.stdout.trim()) {
    return {
      success: false,
      error: {
        code: "DIRTY_WORKSPACE",
        message: "Commit or discard the current changes before switching branches",
      },
    };
  }
  return { success: true };
};

const bindSelectedWorkspace = async (
  ctx: LocalServerContext,
  sessionId: string,
  branch: string,
  workspacePath: string,
): Promise<SwitchSessionGitBranchServiceResult> => {
  try {
    const session = await setSessionWorkspaceBinding(ctx, sessionId, workspacePath);
    if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
    const resolvedPath = session.workspace_path ?? workspacePath;
    logger.info("Switched session {sessionId} to {branch} at {path}", {
      sessionId,
      branch,
      path: resolvedPath,
    });
    return { success: true, result: { branch, workspacePath: resolvedPath } };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) return workspaceBindingFailure(error);
    throw error;
  }
};

const parseWorktrees = (
  output: string,
): {
  byBranch: Map<string, string>;
  byPath: Map<string, string>;
} => {
  const byBranch = new Map<string, string>();
  const byPath = new Map<string, string>();
  let path: string | null = null;
  let branch: string | null = null;
  const commit = () => {
    if (path && branch) {
      byBranch.set(branch, path);
      byPath.set(path, branch);
    }
    path = null;
    branch = null;
  };

  for (const field of output.split("\0")) {
    if (!field) {
      commit();
    } else if (field.startsWith("worktree ")) {
      path = field.slice("worktree ".length);
    } else if (field.startsWith("branch refs/heads/")) {
      branch = field.slice("branch refs/heads/".length);
    }
  }
  commit();
  return { byBranch, byPath };
};

const compareBranches = (left: SessionGitBranch, right: SessionGitBranch): number =>
  Number(right.isCurrent) - Number(left.isCurrent) ||
  Number(right.isDefault) - Number(left.isDefault) ||
  Number(Boolean(right.worktreePath)) - Number(Boolean(left.worktreePath)) ||
  left.name.localeCompare(right.name);

const workspaceBindingFailure = (
  error: WorkspaceBindingError,
): { success: false; error: SessionBranchError } => ({
  success: false,
  error: {
    code: "WORKSPACE_BINDING_ERROR",
    message: error.message,
    path: error.path,
    resettable: error.resettable,
  },
});

const gitFailure = (
  error: unknown,
  fallback: string,
): { success: false; error: SessionBranchError } => ({
  success: false,
  error: {
    code: "GIT_FAILED",
    message: error instanceof Error ? error.message : fallback,
  },
});
