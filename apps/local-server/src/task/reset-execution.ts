import { rm } from "node:fs/promises";
import { GitManager } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/abort.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import { resetTaskDocsForRetry } from "../task-docs/reset-task-docs.ts";
import { resolveTask } from "./resolve.ts";

const logger = getLogger("task-reset");

export type ResetTaskExecutionError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "RESET_FAILED"; taskId: string; message?: string };

export type ResetTaskExecutionResult =
  | { success: true; taskId: string; aborted: boolean }
  | { success: false; error: ResetTaskExecutionError };

export const resetTaskExecution = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<ResetTaskExecutionResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  let aborted = false;
  if (task.status === "WORKING") {
    await abortTask(ctx, task.id, { targetStatus: "BLOCKED" });
    aborted = true;
  }

  try {
    await clearTaskRuntime(ctx, task);
    await resetTaskDocs(ctx, task);
    await resetTaskRecord(ctx, task.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task reset failed for {taskId}: {error}", {
      taskId: task.id,
      error: message,
    });
    return {
      success: false,
      error: { code: "RESET_FAILED", taskId: task.id, message },
    };
  }

  logger.info("Task reset for retry from beginning", { taskId: task.id });
  return { success: true, taskId: task.id, aborted };
};

const clearTaskRuntime = async (ctx: LocalServerContext, task: Task): Promise<void> => {
  await ctx.executionRepository.deleteAllForTask(task.id);

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) return;

  const worktreePath = aopPaths.worktree(task.repo_id, task.id);
  try {
    const gitManager = new GitManager({ repoPath: repo.path, repoId: task.repo_id });
    await gitManager.init();
    await gitManager.removeWorktree(task.id);
  } catch {
    await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  }
};

const resetTaskDocs = async (ctx: LocalServerContext, task: Task): Promise<void> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    throw new Error(`Repo not found: ${task.repo_id}`);
  }

  const taskDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  await resetTaskDocsForRetry(taskDir);
};

const resetTaskRecord = async (ctx: LocalServerContext, taskId: string): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.taskRepository.update(taskId, {
    status: "DRAFT",
    worktree_path: null,
    ready_at: null,
    preferred_workflow: null,
    preferred_provider: null,
    retry_from_step: null,
    resume_input: null,
    updated_at: now,
  });

  const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(taskId);
  if (assignment) {
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId,
      agentId: assignment.agent_id,
      repoId: assignment.repo_id,
      statusColumn: "DRAFT",
    });
  }
};
