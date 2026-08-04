export type ChatWorkLogEventKind =
  | "assistant-status"
  | "assistant-text"
  | "tool"
  | "runtime-warning"
  | "runtime-error"
  | "context-compaction"
  | "user-input"
  | "permission"
  | "session";

export type ChatWorkLogPhase =
  | "started"
  | "updated"
  | "completed"
  | "failed"
  | "requested"
  | "resolved"
  | "resumed"
  | "interrupted";

export type ChatWorkLogStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "warning"
  | "interrupted";

export type ChatWorkLogJsonValue =
  | string
  | number
  | boolean
  | null
  | ChatWorkLogJsonValue[]
  | { [key: string]: ChatWorkLogJsonValue };

export type ChatWorkLogToolKind =
  | "command"
  | "file-read"
  | "file-change"
  | "web-search"
  | "image-view"
  | "mcp"
  | "agent"
  | "dynamic-tool"
  | "generic";

export interface ChatWorkLogEntry {
  id: string;
  runId: string;
  sequence: number;
  provider: string | null;
  kind: ChatWorkLogEventKind;
  phase: ChatWorkLogPhase | null;
  status: ChatWorkLogStatus | null;
  correlationId: string | null;
  title: string | null;
  summary: string | null;
  detail: string | null;
  toolName: string | null;
  toolKind: ChatWorkLogToolKind | null;
  input: ChatWorkLogJsonValue;
  output: ChatWorkLogJsonValue;
  outputText: string | null;
  exitCode: number | null;
  payloadTruncated: boolean;
  occurredAt: string | null;
  metadata: Record<string, ChatWorkLogJsonValue>;
  createdAt: string;
}

export interface CompletedMessageWorkLogResponse {
  sessionId: string;
  assistantMessageId: string;
  runId: string;
  entries: ChatWorkLogEntry[];
}

export interface ActiveRunWorkLogResponse {
  sessionId: string;
  runId: string;
  assistantMessageId: string;
  entries: ChatWorkLogEntry[];
}

export interface AssistantWorkLogUpsertSsePayload {
  type: "assistant-work-log-upsert";
  sessionId: string;
  runId: string;
  assistantMessageId: string;
  entry: ChatWorkLogEntry;
}
