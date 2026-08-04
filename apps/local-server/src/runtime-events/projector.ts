import type { RuntimeEventKind } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import { normalizeRawEvent, parseRawJsonlContent, type RawProviderEvent } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { NewRuntimeEventRecord, StepExecution, StepLog } from "../db/schema.ts";

interface StepProjectionContext {
  taskId: string;
  executionId: string;
  stepExecution: StepExecution;
  agentId: string | null;
}

interface CanonicalRuntimeEventInput {
  kind: RuntimeEventKind;
  title?: string | null;
  message?: string | null;
  toolName?: string | null;
  status?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export const projectRuntimeEventsForStep = async (
  ctx: LocalServerContext,
  stepExecutionId: string,
): Promise<void> => {
  const stepExecution = await ctx.executionRepository.getStepExecution(stepExecutionId);
  if (!stepExecution) return;

  const execution = await ctx.executionRepository.getExecution(stepExecution.execution_id);
  if (!execution) return;

  const taskAssignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(execution.task_id);
  const projectionContext: StepProjectionContext = {
    taskId: execution.task_id,
    executionId: execution.id,
    stepExecution,
    agentId: taskAssignment?.agent_id ?? null,
  };

  const stepLogs = await ctx.runtimeEventRepository.listStepLogs(stepExecutionId);
  const projectedEvents = stepLogs.flatMap((log) => projectLog(projectionContext, log));
  const firstSessionId = projectedEvents.find((event) => event.session_id)?.session_id;
  const events = firstSessionId
    ? projectedEvents.map((event) => ({ ...event, session_id: event.session_id ?? firstSessionId }))
    : projectedEvents;
  await ctx.runtimeEventRepository.insertMany(events);

  const terminalEvent = synthesizeTerminalEvent(projectionContext, events);
  if (terminalEvent) {
    await ctx.runtimeEventRepository.insertMany([terminalEvent]);
  }

  if (firstSessionId && stepExecution.session_id !== firstSessionId) {
    await ctx.executionRepository.updateStepExecution(stepExecution.id, {
      session_id: firstSessionId,
    });
  }
};

const projectLog = (context: StepProjectionContext, log: StepLog): NewRuntimeEventRecord[] => {
  const parsed = parseRawJsonlContent(log.content);

  return parsed.entries.flatMap((entry) => {
    const runtimeProvider = resolveWorkerRuntimeProvider(entry.provider);
    const eventInputs = toCanonicalEvents(
      entry.event,
      context.stepExecution.session_id,
      runtimeProvider,
    );
    return eventInputs.map((eventInput, index) =>
      toRuntimeEventRecord(context, log, entry.index * 100 + index, eventInput),
    );
  });
};

const toCanonicalEvents = (
  event: RawProviderEvent,
  fallbackSessionId: string | null,
  runtimeProvider: WorkerRuntimeProvider,
): CanonicalRuntimeEventInput[] => {
  const sessionId = findSessionId(event) ?? fallbackSessionId;

  if (isSessionStartEvent(event, sessionId)) {
    return [
      {
        kind: "session_started",
        title: `${formatRuntimeProviderLabel(runtimeProvider)} session started`,
        sessionId,
        metadata: { provider: runtimeProvider },
      },
    ];
  }

  if (isPiSessionCompleteEvent(event)) {
    return [
      {
        kind: "session_completed",
        title: `${formatRuntimeProviderLabel(runtimeProvider)} session completed`,
        message:
          findFinalAssistantMessageText(event) ?? findText(event, ["message", "result", "content"]),
        status: "success",
        sessionId,
        metadata: { provider: runtimeProvider },
      },
    ];
  }

  if (isWorkerAttentionEvent(event)) {
    return [
      {
        kind: "worker_attention",
        title: "Worker needs attention",
        message: findText(event, [
          "message",
          "reason",
          "question",
          "pauseContext",
          "pause_context",
        ]),
        sessionId,
        metadata: { provider: runtimeProvider },
      },
    ];
  }

  const explicitToolResult = projectToolResult(event, sessionId, runtimeProvider);
  if (explicitToolResult) {
    return [explicitToolResult];
  }

  return normalizeRawEvent({ index: 0, raw: "", event, provider: runtimeProvider }).flatMap(
    (normalized): CanonicalRuntimeEventInput[] => {
      switch (normalized.kind) {
        case "assistant_text":
          return [
            {
              kind: "assistant_text",
              title: "Assistant update",
              message: normalized.text,
              sessionId,
              metadata: { provider: runtimeProvider },
            },
          ];
        case "tool_started":
          return [
            {
              kind: "tool_started",
              title: `${normalized.toolName} started`,
              message: normalized.description ?? normalized.primaryInput,
              toolName: normalized.toolName,
              status: "started",
              sessionId,
              metadata: { provider: runtimeProvider },
            },
          ];
        case "tool_completed":
          return [
            {
              kind: "tool_completed",
              title: `${normalized.toolName} ${normalized.success ? "completed" : "failed"}`,
              message: normalized.message,
              toolName: normalized.toolName,
              status: normalized.success ? "success" : "failure",
              sessionId,
              metadata: { provider: runtimeProvider },
            },
          ];
        case "result_success":
          return [
            {
              kind: "session_completed",
              title: `${formatRuntimeProviderLabel(runtimeProvider)} session completed`,
              message: normalized.text,
              status: "success",
              sessionId,
              metadata: { provider: runtimeProvider },
            },
          ];
        case "result_error":
        case "error":
          return [
            {
              kind: "session_failed",
              title: `${formatRuntimeProviderLabel(runtimeProvider)} session failed`,
              message: normalized.text,
              status: "failure",
              sessionId,
              metadata: { provider: runtimeProvider },
            },
          ];
        default:
          return [];
      }
    },
  );
};

const STEP_TERMINAL_EVENT_KINDS: Partial<Record<StepExecution["status"], RuntimeEventKind>> = {
  success: "session_completed",
  failure: "session_failed",
  cancelled: "session_interrupted",
};

const SESSION_TERMINAL_EVENT_KINDS = new Set<RuntimeEventKind>([
  "session_completed",
  "session_failed",
  "session_interrupted",
]);

const SYNTHETIC_TERMINAL_TITLES: Partial<Record<RuntimeEventKind, string>> = {
  session_completed: "Session completed",
  session_failed: "Session failed",
  session_interrupted: "Session interrupted",
};

/**
 * Some provider logs (e.g. opencode) never contain a terminal record, so the
 * activity summary would report "running" forever after the run finished — the
 * stuck blue-circle badge. Derive the session outcome from the step execution
 * itself when the projected logs lack one. The (source_kind, source_id,
 * source_index) unique index keeps this idempotent across re-projections.
 */
const synthesizeTerminalEvent = (
  context: StepProjectionContext,
  projectedEvents: NewRuntimeEventRecord[],
): NewRuntimeEventRecord | null => {
  const kind = STEP_TERMINAL_EVENT_KINDS[context.stepExecution.status];
  if (!kind) return null;
  if (projectedEvents.some((event) => SESSION_TERMINAL_EVENT_KINDS.has(event.kind))) return null;

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
    title: SYNTHETIC_TERMINAL_TITLES[kind] ?? null,
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
  log: StepLog,
  sourceIndex: number,
  event: CanonicalRuntimeEventInput,
): NewRuntimeEventRecord => ({
  id: generateTypeId("rte"),
  task_id: context.taskId,
  execution_id: context.executionId,
  step_execution_id: context.stepExecution.id,
  session_id: event.sessionId ?? context.stepExecution.session_id ?? null,
  agent_id: context.agentId,
  kind: event.kind,
  title: event.title ?? null,
  message: event.message ?? null,
  tool_name: event.toolName ?? null,
  status: event.status ?? null,
  source_kind: "step_log",
  source_id: String(log.id),
  source_index: sourceIndex,
  occurred_at: findOccurredAt(log.content) ?? log.created_at,
  metadata_json: event.metadata ? JSON.stringify(event.metadata) : null,
});

const projectToolResult = (
  event: RawProviderEvent,
  sessionId: string | null,
  runtimeProvider: WorkerRuntimeProvider,
): CanonicalRuntimeEventInput | null => {
  if (event.type !== "tool_result") return null;

  const toolName = String(event.tool_name ?? event.name ?? "Tool");
  const failed = Boolean(event.is_error ?? event.error ?? false);
  return {
    kind: "tool_completed",
    title: `${toolName} ${failed ? "failed" : "completed"}`,
    message: findText(event, ["message", "result", "content", "error"]),
    toolName,
    status: failed ? "failure" : "success",
    sessionId,
    metadata: { provider: runtimeProvider },
  };
};

const isSessionStartEvent = (event: RawProviderEvent, sessionId: string | null): boolean => {
  if (!sessionId) return false;
  const type = String(event.type ?? event.event ?? "").toLowerCase();
  return ["system", "session", "session_started", "session_resumed", "thread.started"].includes(
    type,
  );
};

const isPiSessionCompleteEvent = (event: RawProviderEvent): boolean => {
  const type = String(event.type ?? event.event ?? "").toLowerCase();
  return type === "agent_end";
};

type WorkerRuntimeProvider = "pi" | "codex-cli" | "opencode";

const resolveWorkerRuntimeProvider = (provider: string): WorkerRuntimeProvider => {
  if (provider === "opencode" || provider.startsWith("opencode:")) return "opencode";
  if (provider === "codex") return "codex-cli";
  if (provider === "codex-cli") return "codex-cli";
  return "pi";
};

const formatRuntimeProviderLabel = (provider: WorkerRuntimeProvider): string => {
  if (provider === "opencode") return "OpenCode";
  if (provider === "codex-cli") return "Codex CLI";
  return "Pi";
};

const isWorkerAttentionEvent = (event: RawProviderEvent): boolean => {
  const type = String(event.type ?? event.event ?? event.signal ?? "").toLowerCase();
  const status = String(event.status ?? event.subtype ?? "").toLowerCase();
  return (
    type.includes("requires_input") ||
    type.includes("needs_attention") ||
    type.includes("decision") ||
    status.includes("requires_input") ||
    status.includes("needs_attention")
  );
};

const findSessionId = (event: RawProviderEvent): string | null =>
  findString(event.session_id, event.sessionId, event.session, event.thread_id, event.threadId) ??
  findSessionEventId(event) ??
  findMessageSessionId(event);

const findSessionEventId = (event: RawProviderEvent): string | null => {
  const type = String(event.type ?? event.event ?? "").toLowerCase();
  if (!["session", "session_started", "session_resumed"].includes(type)) return null;

  return findString(event.id);
};

const findMessageSessionId = (event: RawProviderEvent): string | null => {
  if (!isRecord(event.message)) return null;

  return findString(event.message.session_id, event.message.sessionId);
};

const findOccurredAt = (content: string): string | null => {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const timestamp = parsed.timestamp ?? parsed.created_at ?? parsed.createdAt ?? parsed.time;
    return typeof timestamp === "string" && timestamp.trim() ? timestamp : null;
  } catch {
    return null;
  }
};

const findText = (event: RawProviderEvent, keys: string[]): string | null =>
  findString(...keys.map((key) => event[key]));

const findString = (...values: unknown[]): string | null => {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const findFinalAssistantMessageText = (event: RawProviderEvent): string | null => {
  const messages = event.messages;
  if (!Array.isArray(messages)) return null;

  const assistantMessage = [...messages]
    .reverse()
    .find(
      (message): message is Record<string, unknown> =>
        isRecord(message) && message.role === "assistant",
    );
  if (!assistantMessage) return null;

  return extractTextFromContent(assistantMessage.content);
};

const extractTextFromContent = (content: unknown): string | null => {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .map((block) => {
      if (!isRecord(block)) return "";
      const text = block.text;
      return typeof text === "string" ? text : "";
    })
    .join("\n")
    .trim();

  return text.length > 0 ? text : null;
};
