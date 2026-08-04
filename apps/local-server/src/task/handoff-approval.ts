import { randomUUID } from "node:crypto";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { recordVerificationEvidence } from "../runtime-events/verification-evidence.ts";
import { handoffCompletedTask } from "./handoff.ts";

const logger = getLogger("handoff-approval");

export type ApproveHandoffResult =
  | {
      success: true;
      taskId: string;
    }
  | {
      success: false;
      error: { code: "NOT_FOUND" | "NOT_PENDING_APPROVAL"; taskId: string };
    };

export interface RejectHandoffInput {
  action: "return_to_draft" | "block";
  reason: string;
}

export type RejectHandoffResult =
  | {
      success: true;
      taskId: string;
    }
  | {
      success: false;
      error: { code: "NOT_FOUND" | "NOT_PENDING_APPROVAL"; taskId: string };
    };

export const approveHandoff = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<ApproveHandoffResult> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", taskId } };
  }

  if (!task.handoff_pending_approval) {
    return { success: false, error: { code: "NOT_PENDING_APPROVAL", taskId } };
  }

  await ctx.taskRepository.update(taskId, { handoff_pending_approval: false });

  try {
    await handoffCompletedTask(ctx, taskId);
  } catch (error) {
    logger.error("Handoff failed after approval for task {taskId}: {error}", {
      taskId,
      error: String(error),
    });
  }

  await recordHumanApprovalEvidence(ctx, taskId);

  return { success: true, taskId };
};

export const rejectHandoff = async (
  ctx: LocalServerContext,
  taskId: string,
  input: RejectHandoffInput,
): Promise<RejectHandoffResult> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", taskId } };
  }

  if (!task.handoff_pending_approval) {
    return { success: false, error: { code: "NOT_PENDING_APPROVAL", taskId } };
  }

  const status = input.action === "block" ? "BLOCKED" : "DRAFT";

  await ctx.taskRepository.update(taskId, {
    handoff_pending_approval: false,
    status,
    ready_at: null,
    retry_from_step: null,
    resume_input: null,
  });

  logger.info("Handoff rejected for task {taskId}: {action} - {reason}", {
    taskId,
    action: input.action,
    reason: input.reason,
  });

  return { success: true, taskId };
};

const recordHumanApprovalEvidence = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<void> => {
  const stepExecution = await ctx.executionRepository.getLatestStepExecution(taskId);
  if (!stepExecution) {
    logger.warn("Skipping human approval evidence for task without step execution", { taskId });
    return;
  }

  const now = new Date().toISOString();

  await recordVerificationEvidence(ctx, {
    taskId,
    executionId: stepExecution.execution_id,
    stepExecutionId: stepExecution.id,
    evidence: {
      kind: "human_approval",
      status: "passed",
      summary: "Human approved handoff",
      source: randomUUID(),
      startedAt: now,
      endedAt: now,
    },
  });
};
