import type { RuntimeActivitySummary, RuntimeEvent } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database, NewRuntimeEventRecord, RuntimeEventRecord, StepLog } from "../db/schema.ts";

export interface RuntimeEventRepository {
  insertMany: (events: NewRuntimeEventRecord[]) => Promise<void>;
  listByExecutionId: (executionId: string) => Promise<RuntimeEvent[]>;
  listByTaskId: (taskId: string) => Promise<RuntimeEvent[]>;
  getActivitySummary: (taskId: string) => Promise<RuntimeActivitySummary | undefined>;
  listStepLogs: (stepExecutionId: string) => Promise<StepLog[]>;
}

const TERMINAL_SESSION_STATES: Partial<
  Record<RuntimeEventRecord["kind"], RuntimeActivitySummary["sessionState"]>
> = {
  session_completed: "completed",
  session_failed: "failed",
  session_interrupted: "interrupted",
};

const SESSION_CONTINUATION_EVENTS = new Set<RuntimeEventRecord["kind"]>([
  "session_started",
  "session_resumed",
  "assistant_text",
  "assistant_summary",
  "tool_started",
  "tool_completed",
  "worker_attention",
  "supervisor_decision_requested",
]);

const INSERT_BATCH_SIZE = 1_000;
const MAX_COMPACT_MESSAGE_LENGTH = 180;

export const createRuntimeEventRepository = (db: Kysely<Database>): RuntimeEventRepository => ({
  insertMany: async (events) => {
    if (events.length === 0) return;

    for (const batch of chunkEvents(events, INSERT_BATCH_SIZE)) {
      await db
        .insertInto("runtime_events")
        .values(batch)
        .onConflict((oc) => oc.columns(["source_kind", "source_id", "source_index"]).doNothing())
        .execute();
    }
  },

  listByExecutionId: async (executionId) => {
    const rows = await db
      .selectFrom("runtime_events")
      .selectAll()
      .where("execution_id", "=", executionId)
      .orderBy("occurred_at", "asc")
      .orderBy("created_at", "asc")
      .execute();

    return rows.map(toRuntimeEvent);
  },

  listByTaskId: async (taskId) => {
    const rows = await db
      .selectFrom("runtime_events")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("occurred_at", "asc")
      .orderBy("created_at", "asc")
      .execute();

    return rows.map(toRuntimeEvent);
  },

  getActivitySummary: async (taskId) => {
    const rows = await db
      .selectFrom("runtime_events")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("occurred_at", "asc")
      .orderBy("created_at", "asc")
      .execute();

    if (rows.length === 0) {
      return undefined;
    }

    return summarizeRuntimeActivity(rows);
  },

  listStepLogs: (stepExecutionId) =>
    db
      .selectFrom("step_logs")
      .selectAll()
      .where("step_execution_id", "=", stepExecutionId)
      .orderBy("id", "asc")
      .execute(),
});

const chunkEvents = (
  events: NewRuntimeEventRecord[],
  batchSize: number,
): NewRuntimeEventRecord[][] => {
  const batches: NewRuntimeEventRecord[][] = [];
  for (let index = 0; index < events.length; index += batchSize) {
    batches.push(events.slice(index, index + batchSize));
  }
  return batches;
};

const summarizeRuntimeActivity = (events: RuntimeEventRecord[]): RuntimeActivitySummary => {
  const latestEvent = events.at(-1);
  const latestMessageEvent = [...events]
    .reverse()
    .find((event) => event.message?.trim() || event.title?.trim());
  const latestSessionEvent = [...events]
    .reverse()
    .find((event) => event.session_id || event.kind.startsWith("session_"));

  return {
    sessionId: latestSessionEvent?.session_id ?? null,
    sessionState: summarizeSessionState(events),
    latestEventKind: latestEvent?.kind ?? null,
    latestEventAt: latestEvent?.occurred_at ?? null,
    latestMessage: summarizeLatestMessage(latestMessageEvent),
    needsAttention: events.some((event) =>
      ["worker_attention", "supervisor_decision_requested"].includes(event.kind),
    ),
    blocked: events.some((event) => event.kind === "task_blocked"),
    handoffProduced: events.some((event) => event.kind === "handoff_produced"),
    verificationEvidenceRecorded: events.some(
      (event) => event.kind === "verification_evidence_recorded",
    ),
  };
};

const summarizeSessionState = (
  events: RuntimeEventRecord[],
): RuntimeActivitySummary["sessionState"] => {
  const latestTerminalIndex = findLatestTerminalEventIndex(events);
  if (latestTerminalIndex === -1) return "running";

  const latestTerminalEvent = events[latestTerminalIndex];
  const terminalState = latestTerminalEvent
    ? (TERMINAL_SESSION_STATES[latestTerminalEvent.kind] ?? "running")
    : "running";
  if (terminalState === "running") return terminalState;

  const laterEvents = events.slice(latestTerminalIndex + 1);
  const resumedAfterTerminal = laterEvents.some((event) =>
    ["session_started", "session_resumed"].includes(event.kind),
  );
  if (resumedAfterTerminal) return "running";

  if (
    terminalState !== "completed" &&
    laterEvents.some((event) => SESSION_CONTINUATION_EVENTS.has(event.kind))
  ) {
    return "running";
  }

  return terminalState;
};

const findLatestTerminalEventIndex = (events: RuntimeEventRecord[]): number => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && event.kind in TERMINAL_SESSION_STATES) return index;
  }
  return -1;
};

const summarizeLatestMessage = (event: RuntimeEventRecord | undefined): string | null => {
  if (!event) return null;

  const title = event.title?.trim() || null;
  const message = event.message?.trim() || null;
  if (!message) return title;

  if (event.kind === "session_completed" && message.length > MAX_COMPACT_MESSAGE_LENGTH) {
    return title ?? "Session completed";
  }

  return compactMessage(message);
};

const compactMessage = (message: string): string => {
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (singleLine.length <= MAX_COMPACT_MESSAGE_LENGTH) return singleLine;
  return `${singleLine.slice(0, MAX_COMPACT_MESSAGE_LENGTH - 3).trimEnd()}...`;
};

const toRuntimeEvent = (event: RuntimeEventRecord): RuntimeEvent => ({
  id: event.id,
  taskId: event.task_id,
  executionId: event.execution_id,
  stepExecutionId: event.step_execution_id,
  sessionId: event.session_id,
  agentId: event.agent_id,
  kind: event.kind,
  title: event.title,
  message: event.message,
  toolName: event.tool_name,
  status: event.status,
  occurredAt: event.occurred_at,
  metadata: parseMetadata(event.metadata_json),
});

const parseMetadata = (metadataJson: string | null): Record<string, unknown> | undefined => {
  if (!metadataJson) return undefined;
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};
