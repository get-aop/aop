import type { RuntimeEventKind } from "@aop/common";
import {
  normalizeRawEvent,
  type ParsedRawLogEntry,
  parseRawJsonlContent,
  type RawProviderEvent,
} from "@aop/llm-provider";

/** One canonical event derived from an agent CLI's JSONL log, independent of what ran it. */
export interface CanonicalRunEvent {
  kind: RuntimeEventKind;
  title: string | null;
  message: string | null;
  toolName: string | null;
  status: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
  /** Stable order within the run: parsed entry index * 100 + event index in that entry. */
  sourceIndex: number;
  /** Timestamp the CLI wrote on the line, when it wrote one. */
  occurredAt: string | null;
}

export type RunOutcome = "success" | "failure" | "cancelled";

const TERMINAL_KIND_BY_OUTCOME: Record<RunOutcome, RuntimeEventKind> = {
  success: "session_completed",
  failure: "session_failed",
  cancelled: "session_interrupted",
};

const SESSION_TERMINAL_EVENT_KINDS = new Set<RuntimeEventKind>([
  "session_completed",
  "session_failed",
  "session_interrupted",
]);

export const TERMINAL_EVENT_TITLES: Partial<Record<RuntimeEventKind, string>> = {
  session_completed: "Session completed",
  session_failed: "Session failed",
  session_interrupted: "Session interrupted",
};

/**
 * Projects the content of one run log line (it may hold several JSONL records)
 * into canonical events. `fallbackSessionId` is the run's known runtime session.
 */
export const projectRunLogLine = (
  content: string,
  fallbackSessionId: string | null,
): CanonicalRunEvent[] => {
  const occurredAt = findOccurredAt(content);
  return parseRawJsonlContent(content).entries.flatMap((entry) =>
    toCanonicalEvents(entry, fallbackSessionId).map((event, index) => ({
      ...event,
      sourceIndex: entry.index * 100 + index,
      occurredAt,
    })),
  );
};

/**
 * Some CLIs never write a terminal record, which would leave the run looking
 * active forever. Returns the terminal kind to synthesize from the run's own
 * outcome, or null when the projected events already end the session.
 */
export const missingTerminalKind = (
  outcome: RunOutcome | null,
  events: Array<{ kind: RuntimeEventKind }>,
): RuntimeEventKind | null => {
  if (!outcome) return null;
  if (events.some((event) => SESSION_TERMINAL_EVENT_KINDS.has(event.kind))) return null;
  return TERMINAL_KIND_BY_OUTCOME[outcome];
};

type EventDraft = Omit<CanonicalRunEvent, "sourceIndex" | "occurredAt">;

const draft = (event: Partial<EventDraft> & Pick<EventDraft, "kind" | "metadata">): EventDraft => ({
  title: null,
  message: null,
  toolName: null,
  status: null,
  sessionId: null,
  ...event,
});

const toCanonicalEvents = (
  entry: ParsedRawLogEntry,
  fallbackSessionId: string | null,
): EventDraft[] => {
  const { event } = entry;
  const runtime = resolveRuntime(entry.provider);
  const runtimeLabel = RUNTIME_LABELS[runtime];
  const sessionId = findSessionId(event) ?? fallbackSessionId;
  const metadata = { provider: runtime };

  if (isSessionStartEvent(event, sessionId)) {
    return [
      draft({
        kind: "session_started",
        title: `${runtimeLabel} session started`,
        sessionId,
        metadata,
      }),
    ];
  }

  if (isPiSessionCompleteEvent(event)) {
    return [
      draft({
        kind: "session_completed",
        title: `${runtimeLabel} session completed`,
        message:
          findFinalAssistantMessageText(event) ?? findText(event, ["message", "result", "content"]),
        status: "success",
        sessionId,
        metadata,
      }),
    ];
  }

  if (isAttentionEvent(event)) {
    return [
      draft({
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
        metadata,
      }),
    ];
  }

  const explicitToolResult = projectToolResult(event, sessionId, metadata);
  if (explicitToolResult) return [explicitToolResult];

  return normalizeRawEvent(entry).flatMap((normalized): EventDraft[] => {
    switch (normalized.kind) {
      case "assistant_text":
        return [
          draft({
            kind: "assistant_text",
            title: "Assistant update",
            message: normalized.text,
            sessionId,
            metadata,
          }),
        ];
      case "tool_started":
        return [
          draft({
            kind: "tool_started",
            title: `${normalized.toolName} started`,
            message: normalized.description ?? normalized.primaryInput,
            toolName: normalized.toolName,
            status: "started",
            sessionId,
            metadata,
          }),
        ];
      case "tool_completed":
        return [
          draft({
            kind: "tool_completed",
            title: `${normalized.toolName} ${normalized.success ? "completed" : "failed"}`,
            message: normalized.message,
            toolName: normalized.toolName,
            status: normalized.success ? "success" : "failure",
            sessionId,
            metadata,
          }),
        ];
      case "result_success":
        return [
          draft({
            kind: "session_completed",
            title: `${runtimeLabel} session completed`,
            message: normalized.text,
            status: "success",
            sessionId,
            metadata,
          }),
        ];
      case "result_error":
      case "error":
        return [
          draft({
            kind: "session_failed",
            title: `${runtimeLabel} session failed`,
            message: normalized.text,
            status: "failure",
            sessionId,
            metadata,
          }),
        ];
      default:
        return [];
    }
  });
};

const projectToolResult = (
  event: RawProviderEvent,
  sessionId: string | null,
  metadata: Record<string, unknown>,
): EventDraft | null => {
  if (event.type !== "tool_result") return null;

  const toolName = String(event.tool_name ?? event.name ?? "Tool");
  const failed = Boolean(event.is_error ?? event.error ?? false);
  return draft({
    kind: "tool_completed",
    title: `${toolName} ${failed ? "failed" : "completed"}`,
    message: findText(event, ["message", "result", "content", "error"]),
    toolName,
    status: failed ? "failure" : "success",
    sessionId,
    metadata,
  });
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

type RunRuntime = "claude-code" | "codex-cli" | "opencode" | "pi";

const RUNTIME_LABELS: Record<RunRuntime, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex CLI",
  opencode: "OpenCode",
  pi: "Pi",
};

/** The CLI a parsed record came from; unrecognized records keep the historical Pi attribution. */
const resolveRuntime = (provider: string): RunRuntime => {
  if (provider === "claude-code") return "claude-code";
  if (provider === "codex" || provider === "codex-cli") return "codex-cli";
  if (provider === "opencode" || provider.startsWith("opencode:")) return "opencode";
  return "pi";
};

const isAttentionEvent = (event: RawProviderEvent): boolean => {
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
