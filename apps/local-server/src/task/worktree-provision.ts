import { access, realpath } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import { toMinimalSessionDto } from "../chat-session/session-dto.ts";
import { publishChatSessionEvent } from "../chat-session/session-events.ts";
import {
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession, Task } from "../db/schema.ts";
import { cleanupStaleTaskDocSymlinksInWorktree } from "../task-docs/worktree-symlink-cleanup.ts";
import { resolveTaskBranchName } from "./branch-name.ts";

const logger = getLogger("task", "worktree-provision");

export type ProvisionedTaskWorktree = {
  path: string;
  branch: string;
  baseBranch: string;
};

/**
 * Create the task branch/worktree if needed, persist paths on the task, and bind
 * the origin chat session so that session is isolated from the shared main checkout.
 */
export const ensureTaskWorktreeAndBindOriginSession = async (
  ctx: LocalServerContext,
  taskId: string,
  bindSessionId?: string | null,
): Promise<ProvisionedTaskWorktree | null> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task) return null;

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    logger.warn("Skipping worktree provision for task {taskId}: repo not found", { taskId });
    return null;
  }

  try {
    const worktree = await createOrReuseTaskWorktree(task, repo.path, repo.id);
    await ctx.taskRepository.update(task.id, {
      branch_name: worktree.branch,
      worktree_path: worktree.path,
    });

    const sessionId = (bindSessionId ?? task.origin_chat_session_id)?.trim() || null;
    if (sessionId) {
      await bindSessionToWorktree(ctx, sessionId, worktree.path);
    }

    return {
      path: worktree.path,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
    };
  } catch (error) {
    logger.warn("Could not provision worktree for task {taskId}: {error}", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * After handoff removes the task worktree, keep the origin chat on the task branch
 * via a session-scoped worktree so create-PR / merge still works from that chat.
 */
export const rebindOriginSessionAfterHandoff = async (
  ctx: LocalServerContext,
  task: Pick<Task, "id" | "repo_id" | "branch_name" | "change_path" | "origin_chat_session_id">,
  previousWorktreePath: string | null,
): Promise<void> => {
  const sessionId = task.origin_chat_session_id?.trim();
  if (!sessionId || !previousWorktreePath) return;

  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return;

  const boundPath = session.workspace_path;
  if (!boundPath) return;

  const taskWorktreePath = aopPaths.worktree(task.repo_id, task.id);
  const stillOnTaskWorktree =
    (await pathsMatch(boundPath, previousWorktreePath)) ||
    (await pathsMatch(boundPath, taskWorktreePath));
  if (!stillOnTaskWorktree) return;

  const branch = resolveTaskBranchName(task);
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) return;

  try {
    const worktreePath = await ensureSessionWorktreeOnBranch(repo.path, repo.id, sessionId, branch);
    await bindSessionToWorktree(ctx, sessionId, worktreePath);
  } catch (error) {
    logger.warn("Could not rebind origin session after handoff for task {taskId}: {error}", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const createOrReuseTaskWorktree = async (
  task: Task,
  repoPath: string,
  repoId: string,
): Promise<WorktreeInfo> => {
  const gitManager = new GitManager({ repoPath, repoId });
  await gitManager.init();
  const baseBranch = task.base_branch ?? (await gitManager.getDefaultBranch());
  const branchName = resolveTaskBranchName(task);

  try {
    const worktree = await gitManager.createWorktree(task.id, baseBranch, branchName);
    await cleanupStaleTaskDocSymlinksInWorktree(worktree.path, task.change_path);
    return worktree;
  } catch (error) {
    if (!(error instanceof WorktreeExistsError)) throw error;

    const actualBranch = await gitManager.getWorktreeBranch(task.id, branchName);
    const worktree: WorktreeInfo = {
      path: aopPaths.worktree(repoId, task.id),
      branch: actualBranch,
      baseBranch,
      baseCommit: "",
    };
    await cleanupStaleTaskDocSymlinksInWorktree(worktree.path, task.change_path);
    return worktree;
  }
};

const ensureSessionWorktreeOnBranch = async (
  repoPath: string,
  repoId: string,
  sessionId: string,
  branchName: string,
): Promise<string> => {
  const worktreePath = aopPaths.worktree(repoId, sessionId);
  if (await pathExists(worktreePath)) return worktreePath;

  const add = await Bun.$`git worktree add ${worktreePath} ${branchName}`
    .cwd(repoPath)
    .quiet()
    .nothrow();
  if (add.exitCode !== 0) {
    throw new Error(add.stderr.toString().trim() || "git worktree add failed");
  }
  return worktreePath;
};

const bindSessionToWorktree = async (
  ctx: LocalServerContext,
  sessionId: string,
  worktreePath: string,
): Promise<void> => {
  try {
    const bound = await setSessionWorkspaceBinding(ctx, sessionId, worktreePath);
    if (!bound) return;
    publishSessionWorkspaceUpdated(bound);
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      logger.warn("Could not bind session {sessionId} to worktree: {error}", {
        sessionId,
        error: error.message,
      });
      return;
    }
    throw error;
  }
};

const publishSessionWorkspaceUpdated = (session: ChatSession): void => {
  publishChatSessionEvent({
    type: "session-updated",
    sessionId: session.id,
    session: toMinimalSessionDto(session),
  });
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const pathsMatch = async (left: string, right: string): Promise<boolean> => {
  const normalize = async (path: string): Promise<string> => {
    try {
      return await realpath(path);
    } catch {
      return resolvePath(path);
    }
  };
  return (await normalize(left)) === (await normalize(right));
};
