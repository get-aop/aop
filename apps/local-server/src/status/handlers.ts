import {
  DEFAULT_DASHBOARD_SWIMLANES,
  type PlanReviewStatus,
  type SSERepoWithTasks,
  type SSEServerStatus,
  type SSETask,
  type TaskSwimlane,
} from "@aop/common";
import { type AgentRoleLane, normalizeAgentRoleLane } from "../agent/roles.ts";
import type { LocalServerContext } from "../context.ts";
import type { Execution, StatusColumn, Task } from "../db/schema.ts";
import { projectRuntimeEventsForStep } from "../runtime-events/projector.ts";
import { hasTaskSpec, readTaskProgress } from "../task/progress.ts";
import type { TaskDependencyState } from "../task/repository.ts";
import { resolveTaskDocsPath } from "../task-docs/paths.ts";
import { readTaskSwimlaneMetadata } from "./swimlane-metadata.ts";

export type RepoStatus = SSERepoWithTasks;
export type ServerStatus = SSEServerStatus;

export interface TaskAssignmentProjection {
  agentId: string;
  agentName: string | null;
  agentRole: AgentRoleLane | null;
  agentWorkflowId: string | null;
  agentWorkflow: string | null;
  statusColumn: StatusColumn;
}

interface TaskSourceProjection {
  provider: string;
  externalRef: string;
  externalUrl: string;
  titleSnapshot: string;
}

export const toSSETask = (
  task: Task,
  execution?: Pick<Execution, "id" | "started_at" | "completed_at" | "workflow_id"> | null,
  repoPath?: string,
  dependencyState?: TaskDependencyState,
  swimlane?: TaskSwimlane,
  assignment?: TaskAssignmentProjection | null,
  source?: TaskSourceProjection | null,
  planReviewStatus?: PlanReviewStatus,
): SSETask => ({
  id: task.id,
  repoId: task.repo_id,
  changePath: task.change_path,
  taskDocsPath: repoPath
    ? resolveTaskDocsPath(task.repo_id, repoPath, task.change_path)
    : undefined,
  status: task.status,
  archivedAt: task.archived_at ?? null,
  branchName: task.branch_name ?? null,
  baseBranch: task.base_branch ?? null,
  preferredProvider: task.preferred_provider ?? null,
  preferredWorkflow: task.preferred_workflow ?? null,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
  errorMessage: undefined,
  completionMode: "pull_request",
  taskProgress: readProgress(task, repoPath),
  swimlane,
  ...toSSEAssignmentFields(assignment),
  ...toSSEExecutionFields(execution),
  hasPlan: readHasPlan(task, repoPath),
  ...toSSEDependencyFields(dependencyState),
  ...toSSESourceFields(source),
  ...(planReviewStatus ? { planReviewStatus } : {}),
});

const readProgress = (task: Task, repoPath?: string) => {
  if (!repoPath) return undefined;
  return readTaskProgress(task.repo_id, repoPath, task.change_path);
};

const readHasPlan = (task: Task, repoPath?: string) => {
  if (!repoPath) return false;
  return hasTaskSpec(task.repo_id, repoPath, task.change_path);
};

const toSSEAssignmentFields = (assignment?: TaskAssignmentProjection | null) => ({
  assignedAgentId: assignment?.agentId ?? null,
  assignedAgentName: assignment?.agentName ?? null,
  assignedAgentRole: assignment?.agentRole ?? null,
  assignedAgentWorkflowId: assignment?.agentWorkflowId ?? null,
  assignedAgentWorkflow: assignment?.agentWorkflow ?? null,
  boardColumn: assignment?.statusColumn,
});

const toSSEExecutionFields = (
  execution?: Pick<Execution, "id" | "started_at" | "completed_at"> | null,
) => ({
  currentExecutionId: execution?.id,
  executionStartedAt: execution?.started_at ?? undefined,
  executionCompletedAt: execution?.completed_at ?? undefined,
});

const toSSEDependencyFields = (dependencyState?: TaskDependencyState) => ({
  dependencyState: dependencyState?.dependencyState,
  blockedByTaskIds: dependencyState?.blockedByTaskIds,
  blockedByRefs: dependencyState?.blockedByRefs,
});

const toSSESourceFields = (source?: TaskSourceProjection | null) => ({
  sourceProvider: source?.provider ?? null,
  sourceRef: source?.externalRef ?? null,
  sourceUrl: source?.externalUrl ?? null,
  sourceTitle: source?.titleSnapshot ?? null,
});

const readPlanReviewStatus = (
  _ctx: LocalServerContext,
  _task: Task,
): PlanReviewStatus | undefined => {
  return undefined;
};

const readRuntimeActivity = async (ctx: LocalServerContext, taskId: string) => {
  await backfillRuntimeEvents(ctx, taskId);
  return ctx.runtimeEventRepository.getActivitySummary(taskId);
};

const backfillRuntimeEvents = async (ctx: LocalServerContext, taskId: string): Promise<void> => {
  const executions = await ctx.executionRepository.getExecutionsByTaskId(taskId);
  await Promise.all(
    executions.map(async (execution) => {
      const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(execution.id);
      await Promise.all(steps.map((step) => projectRuntimeEventsForStep(ctx, step.id)));
    }),
  );
};

const readTaskSourceProjection = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<TaskSourceProjection | null> => {
  const source = await ctx.db
    .selectFrom("task_sources")
    .select([
      "provider",
      "external_ref as externalRef",
      "external_url as externalUrl",
      "title_snapshot as titleSnapshot",
    ])
    .where("task_id", "=", taskId)
    .executeTakeFirst();

  return source ?? null;
};

const readTaskAssignmentProjection = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<TaskAssignmentProjection | null> => {
  const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(taskId);
  if (!assignment) {
    return null;
  }
  const agent = await ctx.agentRepository.getById(assignment.agent_id);
  const workflow =
    agent && agent.status === "active"
      ? ((await ctx.workflowRepository.findById(agent.workflow_id)) ??
        (await ctx.workflowRepository.findByName(agent.workflow_id)))
      : null;
  return {
    agentId: assignment.agent_id,
    agentName: agent?.name ?? null,
    agentRole: normalizeAgentRoleLane(agent?.role),
    agentWorkflowId: workflow?.id ?? agent?.workflow_id ?? null,
    agentWorkflow: workflow?.name ?? agent?.workflow_id ?? null,
    statusColumn: assignment.status_column,
  };
};

export const getServerStatus = async (ctx: LocalServerContext): Promise<ServerStatus> => {
  const repos = await ctx.repoRepository.getAll();

  const repoStatuses = await Promise.all(
    repos.map(async (repo) => {
      const repoTasks = await ctx.taskRepository.list({
        repo_id: repo.id,
        excludeRemoved: true,
      });
      const working = await ctx.taskRepository.countWorking(repo.id);

      const sseTasks = await Promise.all(
        repoTasks.map(async (task) => {
          const executions = await ctx.executionRepository.getExecutionsByTaskId(task.id);
          const execution = executions.find((e) => e.status === "running") ?? executions[0];
          const dependencyState = await ctx.taskRepository.getDependencyState(task.id);
          const swimlane = await readTaskSwimlaneMetadata(repo.path, task);
          const assignment = await readTaskAssignmentProjection(ctx, task.id);
          const source = await readTaskSourceProjection(ctx, task.id);
          const runtimeActivity = await readRuntimeActivity(ctx, task.id);
          const planReviewStatus = readPlanReviewStatus(ctx, task);
          return {
            ...toSSETask(
              task,
              execution,
              repo.path,
              dependencyState,
              swimlane,
              assignment,
              source,
              planReviewStatus,
            ),
            runtimeActivity,
          };
        }),
      );

      return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        working,
        max: repo.max_concurrent_tasks ?? 3,
        tasks: sseTasks,
      };
    }),
  );

  return {
    swimlanes: DEFAULT_DASHBOARD_SWIMLANES,
    repos: repoStatuses,
  };
};
