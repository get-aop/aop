import { randomUUID } from "node:crypto";
import type { VerificationEvidence } from "@aop/common";
import type { LocalServerContext } from "../context.ts";

interface RecordVerificationEvidenceInput {
  taskId: string;
  executionId: string;
  stepExecutionId: string;
  evidence: VerificationEvidence;
}

export const recordVerificationEvidence = async (
  ctx: LocalServerContext,
  input: RecordVerificationEvidenceInput,
): Promise<void> => {
  await ctx.runtimeEventRepository.insertMany([
    {
      id: randomUUID(),
      task_id: input.taskId,
      execution_id: input.executionId,
      step_execution_id: input.stepExecutionId,
      session_id: null,
      agent_id: null,
      kind: "verification_evidence_recorded",
      title: `Verification ${input.evidence.status}`,
      message: input.evidence.summary,
      tool_name: null,
      status: input.evidence.status,
      source_kind: "verification_evidence",
      source_id: buildEvidenceSourceId(input.stepExecutionId, input.evidence),
      source_index: 0,
      occurred_at: input.evidence.endedAt,
      metadata_json: JSON.stringify({ evidence: input.evidence }),
    },
  ]);
};

const buildEvidenceSourceId = (stepExecutionId: string, evidence: VerificationEvidence): string => {
  const source = evidence.command ?? evidence.source ?? evidence.kind;
  return `${stepExecutionId}:${evidence.kind}:${source}`;
};
