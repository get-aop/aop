import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { NewRuntimeEventRecord, StepExecution } from "../db/schema.ts";
import {
  type CanonicalRunEvent,
  missingTerminalKind,
  projectRunLogLine,
  type RunOutcome,
  TERMINAL_EVENT_TITLES,
} from "../process/projector.ts";

interface StepProjectionContext {
  taskId: string;
  executionId: string;
  stepExecution: StepExecution;
  agentId: string | null;
}

const STEP_OUTCOMES: Partial<Record<StepExecution["status"], RunOutcome>> = {
  success: "success",
  failure: "failure",
  cancelled: "cancelled",
};

export const projectRuntimeEventsForStep = async (
  ctx: LocalServerContext,
  stepExecutionId: string,
): Promise<void> => {
  const stepExecution = await ctx.executionRepository.getStepExecution(stepExecutionId);
  if (!stepExecution) return;

  const execution = await ctx.executionRepository.getExecution(stepExecution.execution_id);
  if (!execution) return;

  const taskAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(execution.task_id);
  const context: StepProjectionContext = {
    taskId: execution.task_id,
    executionId: execution.id,
    stepExecution,
    agentId: taskAssignment?.agent_id ?? null,
  };

  const stepLogs = await ctx.runtimeEventRepository.listStepLogs(stepExecutionId);
  const projectedEvents = stepLogs.flatMap((log) =>
    projectRunLogLine(log.content, stepExecution.session_id).map((event) =>
      toRuntimeEventRecord(context, String(log.id), log.created_at, event),
    ),
  );
  const firstSessionId = projectedEvents.find((event) => event.session_id)?.session_id;
  const events = firstSessionId
    ? projectedEvents.map((event) => ({ ...event, session_id: event.session_id ?? firstSessionId }))
    : projectedEvents;
  await ctx.runtimeEventRepository.insertMany(events);

  const terminalEvent = synthesizeTerminalEvent(context, events);
  if (terminalEvent) {
    await ctx.runtimeEventRepository.insertMany([terminalEvent]);
  }

  if (firstSessionId && stepExecution.session_id !== firstSessionId) {
    await ctx.executionRepository.updateStepExecution(stepExecution.id, {
      session_id: firstSessionId,
    });
  }
};

/** The (source_kind, source_id, source_index) unique index keeps this idempotent across re-projections. */
const synthesizeTerminalEvent = (
  context: StepProjectionContext,
  projectedEvents: NewRuntimeEventRecord[],
): NewRuntimeEventRecord | null => {
  const kind = missingTerminalKind(
    STEP_OUTCOMES[context.stepExecution.status] ?? null,
    projectedEvents,
  );
  if (!kind) return null;

  return {
    id: generateTypeId("rte"),
    task_id: context.taskId,
    execution_id: context.executionId,
    step_execution_id: context.stepExecution.id,
    session_id:
      context.stepExecution.session_id ??
      projectedEvents.find((event) => event.session_id)?.session_id ??
      null,
    agent_id: context.agentId,
    kind,
    title: TERMINAL_EVENT_TITLES[kind] ?? null,
    message: context.stepExecution.error,
    tool_name: null,
    status: context.stepExecution.status,
    source_kind: "step_execution",
    source_id: context.stepExecution.id,
    source_index: 0,
    occurred_at: context.stepExecution.ended_at ?? context.stepExecution.started_at,
    metadata_json: null,
  };
};

const toRuntimeEventRecord = (
  context: StepProjectionContext,
  logId: string,
  loggedAt: string,
  event: CanonicalRunEvent,
): NewRuntimeEventRecord => ({
  id: generateTypeId("rte"),
  task_id: context.taskId,
  execution_id: context.executionId,
  step_execution_id: context.stepExecution.id,
  session_id: event.sessionId ?? context.stepExecution.session_id ?? null,
  agent_id: context.agentId,
  kind: event.kind,
  title: event.title,
  message: event.message,
  tool_name: event.toolName,
  status: event.status,
  source_kind: "step_log",
  source_id: logId,
  source_index: event.sourceIndex,
  occurred_at: event.occurredAt ?? loggedAt,
  metadata_json: JSON.stringify(event.metadata),
});
