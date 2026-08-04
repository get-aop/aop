import { realpath } from "node:fs/promises";
import { GitManager, type HandoffResult, WorktreeNotFoundError } from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { resolveTaskBranchName } from "./branch-name.ts";
import { rebindOriginSessionAfterHandoff } from "./worktree-provision.ts";

const logger = getLogger("task-handoff");

export const handoffCompletedTask = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<HandoffResult | null> => {
  const task = await ctx.taskRepository.get(taskId);
  if (task?.status !== "DONE" || !task.worktree_path) {
    return null;
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    logger.warn("Skipping handoff for task {taskId}: repo not found", { taskId });
    return null;
  }

  const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
  await gitManager.init();

  // Capture real path before handoff removes the directory (for session rebind match).
  const previousWorktreePath = task.worktree_path
    ? await realpath(task.worktree_path).catch(() => task.worktree_path)
    : null;

  try {
    const branchName = resolveTaskBranchName(task);
    const result = await gitManager.handoffWorktree(task.id, `Complete ${branchName}`);
    await ctx.taskRepository.update(task.id, { branch_name: result.branch, worktree_path: null });
    await rebindOriginSessionAfterHandoff(
      ctx,
      {
        id: task.id,
        repo_id: task.repo_id,
        branch_name: result.branch,
        change_path: task.change_path,
        origin_chat_session_id: task.origin_chat_session_id,
      },
      previousWorktreePath,
    );
    return result;
  } catch (error) {
    if (error instanceof WorktreeNotFoundError) {
      logger.warn("Skipping handoff for task {taskId}: worktree not found", { taskId });
      await ctx.taskRepository.update(task.id, { worktree_path: null });
      return null;
    }

    throw error;
  }
};
