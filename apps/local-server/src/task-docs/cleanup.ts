import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { GitManager, WorktreeNotFoundError } from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import { resolveTaskDir } from "./paths.ts";
import { cleanupStaleTaskDocSymlinksInWorktree } from "./worktree-symlink-cleanup.ts";

const logger = getLogger("task-docs-cleanup");

export const deleteTaskDocsDir = async (taskDir: string): Promise<void> => {
  if (!existsSync(taskDir)) return;
  await rm(taskDir, { recursive: true, force: true });
};

export const cleanupTaskArtifacts = async (input: {
  repoId: string;
  repoPath: string;
  taskId: string;
  changePath: string;
  worktreePath: string | null;
}): Promise<void> => {
  const taskDir = resolveTaskDir(input.repoId, input.repoPath, input.changePath);
  await deleteTaskDocsDir(taskDir);

  const gitManager = new GitManager({ repoPath: input.repoPath, repoId: input.repoId });
  try {
    await gitManager.init();
    await gitManager.removeWorktree(input.taskId);
  } catch (error) {
    if (!(error instanceof WorktreeNotFoundError)) {
      logger.warn("Failed to remove worktree for task {taskId}: {error}", {
        taskId: input.taskId,
        error: String(error),
      });
    }
  }

  if (input.worktreePath) {
    await cleanupStaleTaskDocSymlinksInWorktree(input.worktreePath, input.changePath);
  }
};
