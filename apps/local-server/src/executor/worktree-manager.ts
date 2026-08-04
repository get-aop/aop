import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import { resolveTaskBranchName } from "../task/branch-name.ts";
import { cleanupStaleTaskDocSymlinksInWorktree } from "../task-docs/worktree-symlink-cleanup.ts";
import type { ExecutorContext } from "./types.ts";

const logger = getLogger("executor");

export const createWorktree = async (ctx: ExecutorContext): Promise<WorktreeInfo> => {
  const gitManager = new GitManager({ repoPath: ctx.repoPath, repoId: ctx.repoId });
  await gitManager.init();
  const baseBranch = ctx.task.base_branch ?? (await gitManager.getDefaultBranch());
  const branchName = resolveTaskBranchName(ctx.task);
  try {
    const worktree = await gitManager.createWorktree(ctx.task.id, baseBranch, branchName);
    await cleanupStaleTaskDocSymlinksInWorktree(worktree.path, ctx.task.change_path);
    return worktree;
  } catch (error) {
    if (error instanceof WorktreeExistsError) {
      logger.warn("Worktree already exists, skipping creation", {
        taskId: ctx.task.id,
      });
      const actualBranch = await gitManager.getWorktreeBranch(ctx.task.id, branchName);
      const worktree = {
        path: aopPaths.worktree(ctx.repoId, ctx.task.id),
        branch: actualBranch,
        baseBranch,
        baseCommit: "",
      };
      await cleanupStaleTaskDocSymlinksInWorktree(worktree.path, ctx.task.change_path);
      return worktree;
    }
    throw error;
  }
};
