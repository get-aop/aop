import { isRepoBulkAction } from "@aop/common";
import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";
import { runRepoBulkAction } from "./bulk-actions.ts";
import {
  handleCreateReviewNote,
  handleDeleteReviewNote,
  handleListFiles,
  handleListReviewNotes,
  handleReadFile,
  handleSubmitReviewNotes,
  handleUpdateReviewNote,
} from "./change-files.ts";
import {
  type AssignTaskWorkerError,
  archiveTask,
  assignTaskWorker,
  blockTask,
  getTaskById,
  type MarkTaskReadyError,
  type MoveTaskBoardColumnError,
  markTaskReady,
  moveTaskToBoardColumn,
  type ResumeTaskError,
  removeTask,
  resetTaskExecution,
  resumeTask,
  unarchiveTask,
} from "./handlers.ts";
import { approveHandoff, type RejectHandoffInput, rejectHandoff } from "./handoff-approval.ts";
import { getTaskPullRequestStatus } from "./pull-request-checks.ts";

export const createTaskRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  // Repo-level bulk action over eligible DONE tasks. Registered before the
  // `/:taskId/*` routes so the static "bulk" segment is never read as a task id.
  routes.post("/bulk/:action", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const action = c.req.param("action");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    if (!isRepoBulkAction(action)) {
      return c.json({ error: `Unknown bulk action: ${action}` }, 400);
    }

    const result = await runRepoBulkAction(ctx, repoId, action);
    return c.json(result);
  });

  routes.get("/:taskId/executions", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const executions = await ctx.executionRepository.getExecutionsByTaskId(taskId);

    const transformedExecutions = await Promise.all(
      executions.map(async (e) => {
        const stepExecutions = await ctx.executionRepository.getStepExecutionsByExecutionId(e.id);
        return {
          id: e.id,
          taskId: e.task_id,
          status: e.status === "aborted" || e.status === "cancelled" ? "failed" : e.status,
          startedAt: e.started_at,
          finishedAt: e.completed_at ?? undefined,
          steps: stepExecutions.map((s) => ({
            id: s.id,
            stepId: s.step_id ?? undefined,
            stepType: s.step_type,
            status: s.status,
            signal: s.signal ?? undefined,
            startedAt: s.started_at,
            endedAt: s.ended_at ?? undefined,
            finishedAt: s.ended_at ?? undefined,
            error: s.error ?? undefined,
          })),
        };
      }),
    );

    return c.json({ executions: transformedExecutions });
  });

  routes.post("/:taskId/ready", async (c) => handleReadyRoute(c, ctx));

  routes.post("/:taskId/reset", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await resetTaskExecution(ctx, taskId);

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "RESET_FAILED":
          return c.json({ error: "Failed to reset task" }, 500);
      }
    }

    return c.json({ ok: true, taskId: result.taskId, aborted: result.aborted });
  });

  routes.post("/:taskId/block", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await blockTask(ctx, taskId);

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "INVALID_STATUS":
          return c.json(
            { error: "Task is not currently working", status: result.error.status },
            409,
          );
      }
    }

    return c.json({ ok: true, taskId: result.taskId, agentKilled: result.agentKilled });
  });

  routes.get("/:taskId/pause-context", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    if (task.status !== "PAUSED") {
      return c.json({ error: "Task is not paused" }, 409);
    }

    const latestStep = await ctx.executionRepository.getLatestStepExecution(taskId);
    return c.json({
      pauseContext: latestStep?.pause_context ?? null,
      signal: latestStep?.signal ?? null,
    });
  });

  routes.post("/:taskId/resume", async (c) => handleResumeRoute(c, ctx));

  routes.post("/:taskId/handoff/approve", async (c) => handleApproveHandoffRoute(c, ctx));
  routes.post("/:taskId/handoff/reject", async (c) => handleRejectHandoffRoute(c, ctx));

  // Read-only PR status for Pool cards (no create/merge/fix mutations — use chat).
  routes.get("/:taskId/pull-request", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await getTaskPullRequestStatus(ctx, taskId);
    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "GH_UNAVAILABLE":
          return c.json({ error: result.error.message }, 503);
      }
    }

    return c.json(result);
  });

  routes.put("/:taskId/assignment", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const body: { agentId?: string | null } = await c.req
      .json<{ agentId?: string | null }>()
      .catch(() => ({}));
    if (body.agentId !== null && typeof body.agentId !== "string") {
      return c.json({ error: "Missing required field: agentId" }, 400);
    }

    const result = await assignTaskWorker(ctx, repoId, taskId, body.agentId);
    if (result.success) {
      return c.json({ ok: true, taskId: result.taskId, assignedAgentId: result.assignedAgentId });
    }

    return mapAssignmentError(c, result.error);
  });

  routes.patch("/:taskId/board-column", async (c) => handleBoardColumnRoute(c, ctx));

  routes.post("/:taskId/archive", async (c) => handleArchiveRoute(c, ctx));
  routes.post("/:taskId/unarchive", async (c) => handleUnarchiveRoute(c, ctx));

  routes.delete("/:taskId", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");
    const force = c.req.query("force") === "true";

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await removeTask(ctx, taskId, { force });

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "ALREADY_REMOVED":
          return c.json({
            ok: true,
            taskId: result.error.taskId,
            alreadyRemoved: true,
          });
        case "TASK_WORKING":
          return c.json({ error: "Task is currently working, use force=true to abort" }, 409);
        case "REMOVE_FAILED":
          return c.json({ error: "Failed to remove task" }, 500);
      }
    }

    return c.json({ ok: true, taskId: result.taskId, aborted: result.aborted });
  });

  routes.get("/:taskId/review-notes", (c) => handleListReviewNotes(ctx, c));
  routes.post("/:taskId/review-notes", (c) => handleCreateReviewNote(ctx, c));
  routes.patch("/:taskId/review-notes/:noteId", (c) => handleUpdateReviewNote(ctx, c));
  routes.delete("/:taskId/review-notes/:noteId", (c) => handleDeleteReviewNote(ctx, c));
  routes.post("/:taskId/review-notes/submit", (c) => handleSubmitReviewNotes(ctx, c));
  routes.get("/:taskId/files", (c) => handleListFiles(ctx, c));
  routes.get("/:taskId/files/*", (c) => handleReadFile(ctx, c));

  return routes;
};

const handleReadyRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const body = await readReadyBody(c);
  const result = await markTaskReady(ctx, taskId, body);
  if (!result.success) return mapMarkReadyError(c, result.error);

  return c.json({ ok: true, taskId: result.task.id });
};

const handleResumeRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const body = await readResumeBody(c);
  if (!body.input) return c.json({ error: "Missing required field: input" }, 400);

  const result = await resumeTask(ctx, taskId, body.input);
  if (result.success) {
    return c.json({ ok: true, taskId: result.taskId, message: "Resume initiated" });
  }

  return mapResumeError(c, result.error);
};

const handleBoardColumnRoute = async (c: Context, ctx: LocalServerContext) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const body = await readBoardColumnBody(c);
  if (!body.column) return c.json({ error: "Invalid board column" }, 400);

  const result = await moveTaskToBoardColumn(ctx, repoId, taskId, body.column, body.agentId);
  if (!result.success) return mapMoveTaskBoardColumnError(c, result.error);

  return c.json({
    ok: true,
    taskId: result.taskId,
    boardColumn: result.boardColumn,
    status: result.status,
    assignedAgentId: result.assignedAgentId,
  });
};

const handleApproveHandoffRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const result = await approveHandoff(ctx, taskId);
  if (!result.success) return mapHandoffApprovalError(c, result.error);

  return c.json({ ok: true, taskId: result.taskId });
};

const handleRejectHandoffRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const input = await readRejectHandoffBody(c);
  if (!input) return c.json({ error: "Invalid handoff rejection" }, 400);

  const result = await rejectHandoff(ctx, taskId, input);
  if (!result.success) return mapHandoffApprovalError(c, result.error);

  return c.json({ ok: true, taskId: result.taskId });
};

const handleArchiveRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const result = await archiveTask(ctx, taskId);
  if (!result.success) return mapArchiveTaskError(c, result.error);

  return c.json({ ok: true, taskId: result.taskId, archivedAt: result.archivedAt });
};

const handleUnarchiveRoute = async (c: Context, ctx: LocalServerContext) => {
  const taskId = c.req.param("taskId") as string;
  const guard = await requireRouteTask(c, ctx);
  if (guard.response) return guard.response;

  const result = await unarchiveTask(ctx, taskId);
  if (!result.success) return mapArchiveTaskError(c, result.error);

  return c.json({ ok: true, taskId: result.taskId, archivedAt: result.archivedAt });
};

const mapArchiveTaskError = (
  c: Context,
  error: { code: "NOT_FOUND"; identifier: string } | { code: "INVALID_STATUS"; status: string },
) => {
  switch (error.code) {
    case "NOT_FOUND":
      return c.json({ error: "Task not found" }, 404);
    case "INVALID_STATUS":
      return c.json({ error: `Task status ${error.status} cannot be archived` }, 409);
  }
};

const requireRouteTask = async (c: Context, ctx: LocalServerContext) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId") as string;

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return { response: c.json({ error: "Repo not found" }, 404) };

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) {
    return { response: c.json({ error: "Task not found" }, 404) };
  }

  return { task, response: null };
};

const readReadyBody = async (c: Context): Promise<{ retryFromStep?: string }> => {
  const body: { retryFromStep?: string } = await c.req
    .json<{ retryFromStep?: string }>()
    .catch(() => ({ retryFromStep: undefined }));

  return {
    retryFromStep: body.retryFromStep,
  };
};

const readResumeBody = async (c: Context): Promise<{ input?: string }> => {
  return c.req.json<{ input?: string }>().catch((): { input?: string } => ({}));
};

const BOARD_COLUMNS = ["DRAFT", "READY", "IN_PROGRESS"] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

const readBoardColumnBody = async (
  c: Context,
): Promise<{ column: BoardColumn | null; agentId: string | null }> => {
  const body = await c.req
    .json<{ column?: string; agentId?: string | null }>()
    .catch((): { column?: string; agentId?: string | null } => ({}));

  return {
    column: parseBoardColumn(body.column),
    agentId: typeof body.agentId === "string" ? body.agentId : null,
  };
};

const parseBoardColumn = (column?: string): BoardColumn | null =>
  BOARD_COLUMNS.includes(column as BoardColumn) ? (column as BoardColumn) : null;

const readRejectHandoffBody = async (c: Context): Promise<RejectHandoffInput | null> => {
  const body = await c.req
    .json<{ action?: string; reason?: string }>()
    .catch((): { action?: string; reason?: string } => ({}));

  const action = body.action;
  const reason = body.reason?.trim();
  if ((action !== "return_to_draft" && action !== "block") || !reason) return null;

  return { action, reason };
};

const mapHandoffApprovalError = (
  c: Context,
  error: { code: "NOT_FOUND" | "NOT_PENDING_APPROVAL"; taskId: string },
) => {
  switch (error.code) {
    case "NOT_FOUND":
      return c.json({ error: "Task not found" }, 404);
    case "NOT_PENDING_APPROVAL":
      return c.json({ error: "Task is not pending handoff approval" }, 409);
  }
};

const MARK_READY_ERROR_MAP: Record<
  MarkTaskReadyError["code"],
  { status: number; message: string }
> = {
  NOT_FOUND: { status: 404, message: "Task not found" },
  ALREADY_READY: { status: 200, message: "Task is already ready" },
  INVALID_STATUS: { status: 409, message: "Invalid task status" },
  NOT_ASSIGNED: { status: 409, message: "Task must be assigned to a worker before marking ready" },
  MISSING_PROMPT_FILE: {
    status: 422,
    message: "Change has no .md files — add at least one to serve as the prompt",
  },
  INVALID_EXECUTION_MODEL: {
    status: 422,
    message: "Task execution model is not runnable by the current local runtime",
  },
  WORKFLOW_NOT_FOUND: {
    status: 409,
    message: "Selected workflow is no longer available",
  },
  UPDATE_FAILED: { status: 500, message: "Failed to update task" },
};

const mapMarkReadyError = (c: Context, error: MarkTaskReadyError) => {
  if (error.code === "ALREADY_READY") {
    return c.json({ ok: true, taskId: error.taskId, alreadyReady: true });
  }

  const mapping = MARK_READY_ERROR_MAP[error.code];
  const extra = {
    ...(error.code === "INVALID_STATUS" ? { status: error.status } : {}),
    ...(error.code === "MISSING_PROMPT_FILE" ? { changePath: error.changePath } : {}),
    ...(error.code === "NOT_ASSIGNED" ? { taskId: error.taskId } : {}),
    ...(error.code === "INVALID_EXECUTION_MODEL" ? { message: error.message } : {}),
  };
  return c.json({ error: mapping.message, ...extra }, mapping.status as 400);
};

const ASSIGNMENT_ERROR_MAP: Record<
  AssignTaskWorkerError["code"],
  { status: number; message: string }
> = {
  NOT_FOUND: { status: 404, message: "Task not found" },
  INVALID_STATUS: { status: 409, message: "Task status does not allow assignment changes" },
  AGENT_NOT_FOUND: { status: 404, message: "Agent not found" },
  AGENT_INACTIVE: { status: 409, message: "Agent is not active" },
  AGENT_REPO_MISMATCH: { status: 409, message: "Agent is not a member of the task repository" },
};

const mapAssignmentError = (c: Context, error: AssignTaskWorkerError) => {
  const mapping = ASSIGNMENT_ERROR_MAP[error.code];
  return c.json({ error: mapping.message, ...error }, mapping.status as 400);
};

const mapMoveTaskBoardColumnError = (c: Context, error: MoveTaskBoardColumnError) => {
  switch (error.code) {
    case "NOT_FOUND":
      return c.json({ error: "Task not found" }, 404);
    case "READY_FAILED":
      return mapMarkReadyError(c, error.reason);
    case "INVALID_STATUS":
      return c.json(
        { error: "Only draft tasks can be moved by drag and drop", status: error.status },
        409,
      );
    case "NOT_ASSIGNED":
      return c.json({ error: "Task must be assigned before moving columns" }, 409);
    default:
      return mapAssignmentError(c, error);
  }
};

const RESUME_ERROR_MAP: Record<ResumeTaskError["code"], { status: number; message?: string }> = {
  NOT_FOUND: { status: 404, message: "Task not found" },
  NOT_PAUSED: { status: 409, message: "Task is not paused" },
  NO_STEP_EXECUTION: { status: 404, message: "No step execution found" },
  RESUME_FAILED: { status: 500 },
};

const mapResumeError = (c: Context, error: ResumeTaskError) => {
  const mapping = RESUME_ERROR_MAP[error.code];
  const message = error.code === "RESUME_FAILED" ? error.message : mapping.message;
  const extra = {
    ...(error.code === "NOT_PAUSED" ? { status: error.status } : {}),
  };
  return c.json({ error: message, ...extra }, mapping.status as 400);
};
