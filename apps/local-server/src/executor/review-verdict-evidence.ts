import type { StepCommand } from "@aop/common/protocol";
import type { LocalServerContext } from "../context.ts";
import { recordVerificationEvidence } from "../runtime-events/verification-evidence.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";

interface RecordReviewVerdictEvidenceInput {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  executionId: string;
  stepId: string;
  stepCommand: StepCommand;
  result: ExecuteResult;
}

const REVIEW_PASSED = "REVIEW_PASSED";
const REVIEW_FAILED = "REVIEW_FAILED";

export const recordReviewVerdictEvidence = async ({
  ctx,
  executorCtx,
  executionId,
  stepId,
  stepCommand,
  result,
}: RecordReviewVerdictEvidenceInput): Promise<void> => {
  const verdict = resolveReviewVerdict(stepCommand, result);
  if (!verdict) return;

  const now = new Date().toISOString();
  await recordVerificationEvidence(ctx, {
    taskId: executorCtx.task.id,
    executionId,
    stepExecutionId: stepId,
    evidence: {
      kind: "review_verdict",
      status: verdict.status,
      summary: `Review verdict ${verdict.status}: ${verdict.signal}`,
      source: stepCommand.stepId ?? stepCommand.type,
      startedAt: now,
      endedAt: now,
    },
  });
};

const resolveReviewVerdict = (
  stepCommand: StepCommand,
  result: ExecuteResult,
): { status: "passed" | "failed"; signal: typeof REVIEW_PASSED | typeof REVIEW_FAILED } | null => {
  if (result.status !== "success") return null;
  if (stepCommand.checkerStep !== true && stepCommand.type !== "review") return null;

  const output = `${result.signal ?? ""}\n${result.assistantOutput}`;
  if (output.includes(REVIEW_PASSED)) return { status: "passed", signal: REVIEW_PASSED };
  if (output.includes(REVIEW_FAILED)) return { status: "failed", signal: REVIEW_FAILED };
  return null;
};
