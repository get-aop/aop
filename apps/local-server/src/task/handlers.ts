import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Agent, StatusColumn, Task, TaskAssignment } from "../db/schema.ts";
import { abortTask } from "../executor/index.ts";
import { cleanupTaskArtifacts } from "../task-docs/cleanup.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import {
  markAcceptanceCriterionChecked,
  TASK_SPEC_REVIEW_ACCEPTANCE_CRITERION,
} from "../task-docs/task.ts";
import { InvalidTaskExecutionModelError, resolveTaskExecutionContext } from "./execution-model.ts";
import { resolveTask } from "./resolve.ts";
import { ensureTaskWorktreeAndBindOriginSession } from "./worktree-provision.ts";

const logger = getLogger("task");

export const getTaskById = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<Task | null> => {
  return ctx.taskRepository.get(taskId);
};

export const resolveTaskByIdentifier = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<Task | null> => {
  return resolveTask(ctx.taskRepository, identifier);
};

export type ResumeTaskResult =
  | { success: true; taskId: string }
  | { success: false; error: ResumeTaskError };

export type ResumeTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "NOT_PAUSED"; status: string }
  | { code: "NO_STEP_EXECUTION" }
  | { code: "RESUME_FAILED"; message: string };

export type ResumeTaskOptions = Record<string, never>;

export const resumeTask = async (
  ctx: LocalServerContext,
  identifier: string,
  input: string,
  _options: ResumeTaskOptions = {},
): Promise<ResumeTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Resume failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "PAUSED") {
    logger.warn("Resume failed: task {taskId} status is {status}, expected PAUSED", {
      taskId: task.id,
      status: task.status,
    });
    return { success: false, error: { code: "NOT_PAUSED", status: task.status } };
  }

  const latestStep = await ctx.executionRepository.getLatestStepExecution(task.id);
  if (!latestStep) {
    logger.error("Resume failed: no step execution found for task {taskId}", { taskId: task.id });
    return { success: false, error: { code: "NO_STEP_EXECUTION" } };
  }

  await ctx.taskRepository.update(task.id, {
    status: "RESUMING",
    resume_input: input,
  });

  logger.info("Task enqueued for resume {taskId}", { taskId: task.id });
  return { success: true, taskId: task.id };
};

export type MarkTaskReadyResult =
  | { success: true; task: Task }
  | { success: false; error: MarkTaskReadyError };

export type MarkTaskReadyError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_READY"; taskId: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "NOT_ASSIGNED"; taskId: string }
  | { code: "MISSING_PROMPT_FILE"; changePath: string }
  | { code: "INVALID_EXECUTION_MODEL"; message: string }
  | { code: "WORKFLOW_NOT_FOUND"; workflow: string }
  | { code: "UPDATE_FAILED" };

export interface MarkTaskReadyOptions {
  retryFromStep?: string;
  handoffRequiresApprovalOverride?: boolean | null;
}

interface ReadyRuntimeOverrides {
  preferredProvider: string | null;
}

const WORKFLOW_DEFINED_MODEL = "workflow-defined";

/** Step agents come from the workflow graph; do not pin the worker profile provider on the task. */
const preferredProviderForReady = (agent: Agent): string | null =>
  agent.model === WORKFLOW_DEFINED_MODEL ? null : agent.provider;

interface ReadyTaskContext {
  task: Task;
  repoPath: string;
  taskDir: string;
}

interface BoardMoveContext {
  task: Task;
  previousAssignment: TaskAssignment | null;
  nextAgentId: string;
}

export type AssignTaskWorkerResult =
  | { success: true; taskId: string; assignedAgentId: string | null }
  | { success: false; error: AssignTaskWorkerError };

export type AssignTaskWorkerError =
  | { code: "NOT_FOUND" }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "AGENT_NOT_FOUND"; agentId: string }
  | { code: "AGENT_INACTIVE"; agentId: string }
  | { code: "AGENT_REPO_MISMATCH"; agentId: string; repoId: string };

export type MoveTaskBoardColumnResult =
  | {
      success: true;
      taskId: string;
      boardColumn: StatusColumn;
      status: Task["status"];
      assignedAgentId: string;
    }
  | { success: false; error: MoveTaskBoardColumnError };

export type MoveTaskBoardColumnError =
  | { code: "NOT_FOUND" }
  | { code: "NOT_ASSIGNED" }
  | { code: "INVALID_STATUS"; status: string }
  | AssignTaskWorkerError
  | { code: "READY_FAILED"; reason: MarkTaskReadyError };

const getMarkTaskReadyError = (task: Task): MarkTaskReadyError | null => {
  if (task.status === "READY") {
    return { code: "ALREADY_READY", taskId: task.id };
  }

  if (task.status !== "DRAFT" && task.status !== "BLOCKED") {
    return { code: "INVALID_STATUS", status: task.status };
  }

  return null;
};

const buildReadyTaskUpdate = (
  options?: MarkTaskReadyOptions,
  runtimeOverrides: ReadyRuntimeOverrides = {
    preferredProvider: null,
  },
) => ({
  status: "READY" as const,
  ready_at: new Date().toISOString(),
  base_branch: null,
  preferred_provider: runtimeOverrides.preferredProvider,
  retry_from_step: options?.retryFromStep ?? null,
  handoff_requires_approval_override: options?.handoffRequiresApprovalOverride ?? null,
});

const requireAssignedWorker = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<{ success: true } | { success: false; error: MarkTaskReadyError }> => {
  const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(taskId);
  if (!assignment) {
    return { success: false, error: { code: "NOT_ASSIGNED", taskId } };
  }

  const agent = await ctx.agentRepository.getById(assignment.agent_id);
  if (agent?.status !== "active") {
    return { success: false, error: { code: "NOT_ASSIGNED", taskId } };
  }

  return { success: true };
};

const toStatusColumn = (status: Task["status"]): StatusColumn => {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "READY":
      return "READY";
    case "DONE":
    case "REMOVED":
      return "DONE";
    default:
      return "IN_PROGRESS";
  }
};

const readyStatusColumnFor = (current: TaskAssignment | null): StatusColumn =>
  current?.status_column === "IN_PROGRESS" ? "IN_PROGRESS" : "READY";

const isAssignableStatus = (status: Task["status"]): boolean => {
  return status === "DRAFT" || status === "READY" || status === "BLOCKED" || status === "PAUSED";
};

const hasRepoMembership = async (
  ctx: LocalServerContext,
  agentId: string,
  repoId: string,
): Promise<boolean> => {
  const memberships = await ctx.agentRepository.listRepoMemberships(agentId);
  return memberships.some((membership) => membership.repo_id === repoId);
};

const resolveReadyRuntimeOverrides = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<ReadyRuntimeOverrides> => {
  const currentAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(task.id);
  if (!currentAssignment) {
    return { preferredProvider: null };
  }

  const agent = await ctx.agentRepository.getById(currentAssignment.agent_id);
  if (agent?.status !== "active") {
    return { preferredProvider: null };
  }

  return { preferredProvider: preferredProviderForReady(agent) };
};

const validateAssignedAgentRepositories = async (
  ctx: LocalServerContext,
  agentId: string,
  repositories: Array<{ repoId: string; assignment: string }>,
): Promise<void> => {
  const memberships = await ctx.agentRepository.listRepoMemberships(agentId);
  const memberRepoIds = new Set(memberships.map((membership) => membership.repo_id));

  for (const repository of repositories) {
    if (memberRepoIds.has(repository.repoId)) {
      continue;
    }

    const scopeLabel =
      repository.assignment === "supporting" ? "supporting repository" : "repository";
    throw new InvalidTaskExecutionModelError(
      `Assigned agent '${agentId}' is not a member of ${scopeLabel} '${repository.repoId}'`,
    );
  }
};

const syncTaskAssignmentFromExecutionContext = async (
  ctx: LocalServerContext,
  task: Task,
  repoPath: string,
): Promise<ReadyRuntimeOverrides> => {
  const executionContext = await resolveTaskExecutionContext(task, repoPath, ctx.repoRepository);
  const developerAssignment = executionContext.developerAssignment;

  if (!executionContext.model) {
    return resolveReadyRuntimeOverrides(ctx, task);
  }

  if (!developerAssignment?.agentId) {
    await ctx.taskAssignmentRepository.clearCurrentByTaskId(task.id);
    return { preferredProvider: null };
  }

  const agent = await ctx.agentRepository.getById(developerAssignment.agentId);
  if (!agent) {
    throw new InvalidTaskExecutionModelError(
      `Execution model references missing agent '${developerAssignment.agentId}'`,
    );
  }

  if (agent.status !== "active") {
    throw new InvalidTaskExecutionModelError(
      `Execution model references inactive agent '${developerAssignment.agentId}'`,
    );
  }

  await validateAssignedAgentRepositories(
    ctx,
    developerAssignment.agentId,
    developerAssignment.repositories,
  );

  const currentAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(task.id);
  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId: task.id,
    agentId: agent.id,
    repoId: task.repo_id,
    statusColumn: readyStatusColumnFor(currentAssignment),
  });

  return { preferredProvider: preferredProviderForReady(agent) };
};

export const assignTaskWorker = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  agentId: string | null,
): Promise<AssignTaskWorkerResult> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task || task.repo_id !== repoId) {
    return { success: false, error: { code: "NOT_FOUND" } };
  }

  if (!isAssignableStatus(task.status)) {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }

  if (agentId === null) {
    await ctx.taskAssignmentRepository.clearCurrentByTaskId(task.id);
    if (task.status === "READY") {
      await ctx.taskRepository.update(task.id, {
        status: "DRAFT",
        ready_at: null,
        retry_from_step: null,
      });
    }
    return { success: true, taskId: task.id, assignedAgentId: null };
  }

  const agent = await ctx.agentRepository.getById(agentId);
  if (!agent) {
    return { success: false, error: { code: "AGENT_NOT_FOUND", agentId } };
  }

  if (agent.status !== "active") {
    return { success: false, error: { code: "AGENT_INACTIVE", agentId } };
  }

  if (!(await hasRepoMembership(ctx, agentId, repoId))) {
    return { success: false, error: { code: "AGENT_REPO_MISMATCH", agentId, repoId } };
  }

  const currentAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(task.id);
  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId: task.id,
    agentId,
    repoId,
    statusColumn: currentAssignment?.status_column ?? toStatusColumn(task.status),
  });

  // Isolated branch/worktree at assign time so the origin chat is not on the shared main checkout.
  await ensureTaskWorktreeAndBindOriginSession(ctx, task.id);

  return { success: true, taskId: task.id, assignedAgentId: agentId };
};

export const moveTaskToBoardColumn = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  boardColumn: StatusColumn,
  agentId: string | null,
): Promise<MoveTaskBoardColumnResult> => {
  const boardMove = await readBoardMoveContext(ctx, repoId, taskId, agentId);
  if (!boardMove.success) return boardMove;

  const assignmentResult = await ensureBoardMoveAssignment(ctx, repoId, taskId, boardMove.context);
  if (!assignmentResult.success) return assignmentResult;

  if (boardColumn === "READY") {
    return moveTaskToReadyColumn(ctx, repoId, taskId, boardMove.context);
  }

  if (boardColumn === "IN_PROGRESS") {
    return moveTaskToInProgressColumn(ctx, repoId, taskId, boardMove.context);
  }

  if (boardMove.context.task.status !== "DRAFT") {
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: boardMove.context.task.status },
    };
  }

  return moveTaskToDraftColumn(ctx, repoId, taskId, boardMove.context.nextAgentId);
};

const readBoardMoveContext = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  agentId: string | null,
): Promise<
  { success: true; context: BoardMoveContext } | { success: false; error: MoveTaskBoardColumnError }
> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task || task.repo_id !== repoId) {
    return { success: false, error: { code: "NOT_FOUND" } };
  }

  if (task.status !== "DRAFT" && task.status !== "READY") {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }

  const previousAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(taskId);
  const nextAgentId = agentId ?? previousAssignment?.agent_id ?? null;
  if (!nextAgentId) {
    return { success: false, error: { code: "NOT_ASSIGNED" } };
  }

  return {
    success: true,
    context: {
      task,
      previousAssignment,
      nextAgentId,
    },
  };
};

const ensureBoardMoveAssignment = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  context: BoardMoveContext,
): Promise<{ success: true } | { success: false; error: MoveTaskBoardColumnError }> => {
  if (context.previousAssignment?.agent_id === context.nextAgentId) {
    return { success: true };
  }

  const assignmentResult = await assignTaskWorker(ctx, repoId, taskId, context.nextAgentId);
  if (!assignmentResult.success) {
    return { success: false, error: assignmentResult.error };
  }

  return { success: true };
};

const moveTaskToReadyColumn = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  context: BoardMoveContext,
): Promise<MoveTaskBoardColumnResult> => {
  const readyResult = await markTaskReady(ctx, taskId);
  if (!readyResult.success) {
    await restoreBoardAssignment(ctx, taskId, context.previousAssignment);
    return { success: false, error: { code: "READY_FAILED", reason: readyResult.error } };
  }

  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId,
    agentId: context.nextAgentId,
    repoId,
    statusColumn: "READY",
  });

  return {
    success: true,
    taskId,
    boardColumn: "READY",
    status: "READY",
    assignedAgentId: context.nextAgentId,
  };
};

const moveTaskToDraftColumn = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  agentId: string,
): Promise<MoveTaskBoardColumnResult> => {
  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId,
    agentId,
    repoId,
    statusColumn: "DRAFT",
  });

  return {
    success: true,
    taskId,
    boardColumn: "DRAFT",
    status: "DRAFT",
    assignedAgentId: agentId,
  };
};

const moveTaskToInProgressColumn = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  context: BoardMoveContext,
): Promise<MoveTaskBoardColumnResult> => {
  if (context.task.status !== "READY" && context.task.status !== "DRAFT") {
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: context.task.status },
    };
  }

  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId,
    agentId: context.nextAgentId,
    repoId,
    statusColumn: "IN_PROGRESS",
  });

  if (context.task.status === "DRAFT") {
    const readyResult = await markTaskReady(ctx, taskId);
    if (!readyResult.success) {
      await restoreBoardAssignment(ctx, taskId, context.previousAssignment);
      return { success: false, error: { code: "READY_FAILED", reason: readyResult.error } };
    }
  }

  // Ensure worktree exists for start paths that skipped plain assign.
  await ensureTaskWorktreeAndBindOriginSession(ctx, taskId);

  return {
    success: true,
    taskId,
    boardColumn: "IN_PROGRESS",
    status: "READY",
    assignedAgentId: context.nextAgentId,
  };
};

const restoreBoardAssignment = async (
  ctx: LocalServerContext,
  taskId: string,
  assignment: TaskAssignment | null,
): Promise<void> => {
  if (!assignment) {
    await ctx.taskAssignmentRepository.clearCurrentByTaskId(taskId);
    return;
  }

  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId,
    agentId: assignment.agent_id,
    repoId: assignment.repo_id,
    statusColumn: assignment.status_column,
  });
};

export const markTaskReady = async (
  ctx: LocalServerContext,
  identifier: string,
  options?: MarkTaskReadyOptions,
): Promise<MarkTaskReadyResult> => {
  const readyContext = await readReadyTaskContext(ctx, identifier);
  if (!readyContext.success) return readyContext;

  const assignmentCheck = await requireAssignedWorker(ctx, readyContext.task.id);
  if (!assignmentCheck.success) return assignmentCheck;
  const workflowCheck = await validateReadyTaskWorkflow(ctx, readyContext.task);
  if (!workflowCheck.success) return workflowCheck;

  const currentAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(
    readyContext.task.id,
  );
  if (currentAssignment) {
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: currentAssignment.task_id,
      agentId: currentAssignment.agent_id,
      repoId: currentAssignment.repo_id,
      statusColumn: readyStatusColumnFor(currentAssignment),
    });
  }

  const runtimeOverrides = await resolveReadyOverrides(ctx, readyContext);
  if (!runtimeOverrides.success) return runtimeOverrides;

  const readyOptions = await resolveReadyOptions(ctx, readyContext.task, options);
  const readyResult = await updateReadyTask(
    ctx,
    readyContext.task,
    readyOptions,
    runtimeOverrides.overrides,
  );
  if (readyResult.success) {
    await markAcceptanceCriterionChecked(
      join(readyContext.taskDir, "task.md"),
      TASK_SPEC_REVIEW_ACCEPTANCE_CRITERION,
    );
  }

  return readyResult;
};

const validateReadyTaskWorkflow = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<
  { success: true } | { success: false; error: { code: "WORKFLOW_NOT_FOUND"; workflow: string } }
> => {
  if (!task.preferred_workflow) return { success: true };
  const workflow = await ctx.workflowRepository.findByName(task.preferred_workflow);
  return workflow?.active
    ? { success: true }
    : {
        success: false,
        error: { code: "WORKFLOW_NOT_FOUND", workflow: task.preferred_workflow },
      };
};

const resolveReadyOptions = async (
  ctx: LocalServerContext,
  task: Task,
  options?: MarkTaskReadyOptions,
): Promise<MarkTaskReadyOptions | undefined> => {
  if (options?.retryFromStep) return options;
  if (task.status !== "BLOCKED") return options;

  const latestStep = await ctx.executionRepository.getLatestStepExecution(task.id);
  const retryFromStep = latestStep?.step_id ?? undefined;
  return retryFromStep ? { ...options, retryFromStep } : options;
};

const readReadyTaskContext = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<
  ({ success: true } & ReadyTaskContext) | { success: false; error: MarkTaskReadyError }
> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Mark ready failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  const invalidState = getMarkTaskReadyError(task);
  if (invalidState) {
    logInvalidReadyState(task, invalidState);
    return { success: false, error: invalidState };
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) return { success: false, error: { code: "NOT_FOUND", identifier } };

  const taskDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  if (!hasMarkdownFile(taskDir)) {
    logger.warn("Mark ready failed: no .md files at {changePath}", {
      changePath: task.change_path,
    });
    return { success: false, error: { code: "MISSING_PROMPT_FILE", changePath: task.change_path } };
  }

  return { success: true, task, repoPath: repo.path, taskDir };
};

const logInvalidReadyState = (task: Task, error: MarkTaskReadyError): void => {
  if (error.code !== "INVALID_STATUS") return;

  logger.warn("Mark ready failed: invalid status {status} for task {taskId}", {
    status: task.status,
    taskId: task.id,
  });
};

const updateReadyTask = async (
  ctx: LocalServerContext,
  task: Task,
  options: MarkTaskReadyOptions | undefined,
  runtimeOverrides: ReadyRuntimeOverrides,
): Promise<MarkTaskReadyResult> => {
  const updated = await ctx.taskRepository.update(
    task.id,
    buildReadyTaskUpdate(options, runtimeOverrides),
  );

  if (!updated) {
    logger.error("Mark ready failed: update returned null for task {taskId}", { taskId: task.id });
    return { success: false, error: { code: "UPDATE_FAILED" } };
  }

  logger.info("Task marked ready {taskId} ({changePath})", {
    taskId: updated.id,
    changePath: updated.change_path,
  });
  return { success: true, task: updated };
};

const resolveReadyOverrides = async (
  ctx: LocalServerContext,
  readyContext: ReadyTaskContext,
): Promise<
  | { success: true; overrides: ReadyRuntimeOverrides }
  | { success: false; error: MarkTaskReadyError }
> => {
  try {
    const overrides = await syncTaskAssignmentFromExecutionContext(
      ctx,
      readyContext.task,
      readyContext.repoPath,
    );
    return { success: true, overrides };
  } catch (error) {
    if (!(error instanceof InvalidTaskExecutionModelError)) throw error;

    logger.warn("Mark ready failed: invalid execution model for task {taskId}: {error}", {
      taskId: readyContext.task.id,
      error: error.message,
    });
    return { success: false, error: { code: "INVALID_EXECUTION_MODEL", message: error.message } };
  }
};

export type RemoveTaskResult =
  | { success: true; taskId: string; aborted: boolean }
  | { success: false; error: RemoveTaskError };

export type RemoveTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_REMOVED"; taskId: string }
  | { code: "TASK_WORKING"; taskId: string }
  | { code: "REMOVE_FAILED" };

export interface RemoveTaskOptions {
  force?: boolean;
}

export type ArchiveTaskResult =
  | { success: true; taskId: string; archivedAt: string | null; alreadyArchived?: boolean }
  | { success: false; error: ArchiveTaskError };

export type ArchiveTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "INVALID_STATUS"; status: string };

export type UnarchiveTaskResult =
  | { success: true; taskId: string; archivedAt: string | null; alreadyUnarchived?: boolean }
  | { success: false; error: ArchiveTaskError };

export const removeTask = async (
  ctx: LocalServerContext,
  identifier: string,
  options: RemoveTaskOptions = {},
): Promise<RemoveTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Remove failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status === "REMOVED") {
    return {
      success: false,
      error: { code: "ALREADY_REMOVED", taskId: task.id },
    };
  }

  if (task.status === "WORKING") {
    if (!options.force) {
      logger.warn("Remove blocked: task {taskId} is working (use force)", { taskId: task.id });
      return {
        success: false,
        error: { code: "TASK_WORKING", taskId: task.id },
      };
    }

    logger.info("Force removing working task {taskId}, aborting agent", { taskId: task.id });
    await abortTask(ctx, task.id);
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  const success = await ctx.taskRepository.markRemoved(task.id);
  if (!success) {
    logger.error("Remove failed: markRemoved returned false for task {taskId}", {
      taskId: task.id,
    });
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  await cleanupTaskArtifacts({
    repoId: task.repo_id,
    repoPath: repo.path,
    taskId: task.id,
    changePath: task.change_path,
    worktreePath: task.worktree_path,
  });

  logger.info("Task removed {taskId} ({changePath})", {
    taskId: task.id,
    changePath: task.change_path,
  });
  return {
    success: true,
    taskId: task.id,
    aborted: task.status === "WORKING",
  };
};

export const archiveTask = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<ArchiveTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) return { success: false, error: { code: "NOT_FOUND", identifier } };
  if (task.status !== "DONE") {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }
  if (task.archived_at) {
    return { success: true, taskId: task.id, archivedAt: task.archived_at, alreadyArchived: true };
  }

  const archivedAt = new Date().toISOString();
  await ctx.taskRepository.update(task.id, { archived_at: archivedAt });
  return { success: true, taskId: task.id, archivedAt };
};

export const unarchiveTask = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<UnarchiveTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) return { success: false, error: { code: "NOT_FOUND", identifier } };
  if (!task.archived_at) {
    return { success: true, taskId: task.id, archivedAt: null, alreadyUnarchived: true };
  }
  if (task.status !== "DONE") {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }

  await ctx.taskRepository.update(task.id, { archived_at: null });
  return { success: true, taskId: task.id, archivedAt: null };
};

export type BlockTaskResult =
  | { success: true; taskId: string; agentKilled: boolean }
  | { success: false; error: BlockTaskError };

export type BlockTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "INVALID_STATUS"; status: string };

export type {
  ResetTaskExecutionError,
  ResetTaskExecutionResult,
} from "./reset-execution.ts";
export { resetTaskExecution } from "./reset-execution.ts";

export const blockTask = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<BlockTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Block failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "WORKING") {
    logger.warn("Block failed: task {taskId} status is {status}, expected WORKING", {
      taskId: task.id,
      status: task.status,
    });
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: task.status },
    };
  }

  logger.info("Blocking task {taskId}, aborting agent", { taskId: task.id });
  const result = await abortTask(ctx, task.id, {
    targetStatus: "BLOCKED",
  });
  logger.info("Task blocked {taskId} (agentKilled={agentKilled})", {
    taskId: task.id,
    agentKilled: result.agentKilled,
  });
  return { success: true, taskId: task.id, agentKilled: result.agentKilled };
};

const hasMarkdownFile = (changePath: string): boolean => {
  if (!existsSync(changePath)) return false;
  const entries = readdirSync(changePath);
  return entries.some((entry) => entry.endsWith(".md"));
};
