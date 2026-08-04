import { suggestSessionBranchName } from "@aop/common";
import {
  BranchNotFoundError,
  GitManager,
  NotAGitRepositoryError,
  WorktreeExistsError,
} from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import {
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";

const logger = getLogger("session-git", "worktree");

export { suggestSessionBranchName };

export interface CreateSessionWorktreeInput {
  branchName?: string;
  baseBranch?: string;
}

export interface SessionWorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
}

export type CreateSessionWorktreeResult =
  | {
      success: true;
      worktree: SessionWorktreeInfo;
      session: { id: string; workspacePath: string };
    }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "NOT_A_GIT_REPO"; message: string }
        | { code: "BRANCH_EXISTS"; message: string }
        | { code: "WORKTREE_EXISTS"; message: string }
        | { code: "BASE_BRANCH_NOT_FOUND"; message: string }
        | {
            code: "WORKSPACE_BINDING_ERROR";
            message: string;
            path: string | null;
            resettable: boolean;
          }
        | { code: "INVALID_BRANCH_NAME"; message: string };
    };

/** Create a session-scoped worktree, bind the session workspace, and return the new location. */
export const createSessionWorktree = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: CreateSessionWorktreeInput,
): Promise<CreateSessionWorktreeResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) {
    return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  }

  const repo = await resolveSessionRepo(ctx, session);
  if (!repo) {
    return {
      success: false,
      error: {
        code: "NOT_A_GIT_REPO",
        message: "Session is not bound to a git repository",
      },
    };
  }

  const branchName = resolveRequestedBranchName(session, input.branchName);
  if (!branchName) {
    return {
      success: false,
      error: { code: "INVALID_BRANCH_NAME", message: "Branch name is required" },
    };
  }

  try {
    const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
    await gitManager.init();

    const baseBranch = input.baseBranch?.trim() || (await gitManager.getDefaultBranch());
    const branchCollision = await branchExists(repo.path, branchName);
    if (branchCollision) {
      return {
        success: false,
        error: {
          code: "BRANCH_EXISTS",
          message: `Branch already exists: ${branchName}`,
        },
      };
    }

    const worktree = await gitManager.createWorktree(session.id, baseBranch, branchName);
    const bound = await setSessionWorkspaceBinding(ctx, session.id, worktree.path);
    if (!bound) {
      return { success: false, error: { code: "SESSION_NOT_FOUND" } };
    }

    logger.info("Created session worktree {sessionId} at {path} on {branch}", {
      sessionId: session.id,
      path: worktree.path,
      branch: worktree.branch,
    });

    return {
      success: true,
      worktree: {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch,
      },
      session: {
        id: bound.id,
        workspacePath: bound.workspace_path ?? worktree.path,
      },
    };
  } catch (error) {
    return mapCreateWorktreeError(error);
  }
};

const resolveSessionRepo = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<{ id: string; path: string } | null> => {
  if (!session.repo_id) return null;
  const repo = await ctx.repoRepository.getById(session.repo_id);
  if (!repo) return null;
  return { id: repo.id, path: repo.path };
};

const resolveRequestedBranchName = (
  session: ChatSession,
  branchName: string | undefined,
): string | null => {
  const requested = branchName?.trim();
  if (requested) return requested;
  return suggestSessionBranchName(session.title, session.id);
};

const branchExists = async (repoPath: string, branchName: string): Promise<boolean> => {
  const result = await Bun.$`git rev-parse --verify ${`refs/heads/${branchName}`}`
    .cwd(repoPath)
    .quiet()
    .nothrow();
  return result.exitCode === 0;
};

const mapCreateWorktreeError = (
  error: unknown,
): Extract<CreateSessionWorktreeResult, { success: false }> => {
  if (error instanceof NotAGitRepositoryError) {
    return {
      success: false,
      error: { code: "NOT_A_GIT_REPO", message: error.message },
    };
  }
  if (error instanceof WorktreeExistsError) {
    return {
      success: false,
      error: {
        code: "WORKTREE_EXISTS",
        message: `A worktree already exists for this session: ${error.taskId}`,
      },
    };
  }
  if (error instanceof BranchNotFoundError) {
    return {
      success: false,
      error: {
        code: "BASE_BRANCH_NOT_FOUND",
        message: error.message,
      },
    };
  }
  if (error instanceof WorkspaceBindingError) {
    return {
      success: false,
      error: {
        code: "WORKSPACE_BINDING_ERROR",
        message: error.message,
        path: error.path,
        resettable: error.resettable,
      },
    };
  }
  throw error;
};
