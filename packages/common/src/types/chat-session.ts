/** Shared chat-session types used by local-server and dashboard client. */

export type ChatSessionScope = "repository" | "general";
export type ChatSessionSettledOverride = "settled" | "active";

/**
 * Session-scoped assistant lifecycle for list/detail/SSE agreement.
 * - idle: no accepted or running work
 * - pending: accepted; provider not yet spawning
 * - running: live provider work in this process
 * - cancelling: stop/steer/reset requested; termination in progress
 * - recovering: durable running row after restart without a live handle
 * - uncontrollable: recovered/detached work that cannot be OS-stopped safely
 */
export type ChatSessionLifecycle =
  | "idle"
  | "pending"
  | "running"
  | "cancelling"
  | "recovering"
  | "uncontrollable";

export type ChatAbortDisposition = "none" | "interrupt_requested" | "durable_cancelled";

export type ChatDocumentMimeType =
  | "text/markdown"
  | "text/plain"
  | "text/csv"
  | "text/tab-separated-values";

export interface ChatDocumentAttachment {
  id: string;
  fileName: string;
  mimeType: ChatDocumentMimeType;
  dataBase64: string;
}

export const CHAT_DOCUMENT_LIMITS = {
  maxCount: 2,
  maxBytes: 256 * 1024,
  allowedMimeTypes: ["text/markdown", "text/plain", "text/csv", "text/tab-separated-values"],
  allowedExtensions: ["md", "txt", "csv", "tsv"],
} as const;

/** Legacy navigation actions plus chat-first typed cards. */
type ChatActionType =
  | "task"
  | "pool"
  | "workflows"
  | "review"
  | "workerNew"
  /** Switch the dashboard to this session id (e.g. after /clear). */
  | "session"
  | "task-assignment"
  | "task-batch-assignment"
  | "workflow-preview"
  | "worker-card"
  | "task-live"
  | "approval"
  | "status-summary"
  | "workflow-run"
  | "runtime-actions";

type ChatActionStatus = "proposed" | "confirmed" | "stale" | "error" | "live";

export interface ChatActionPayload {
  type: ChatActionType;
  id?: string;
  label: string;
  sub: string;
  meta: string;
  status?: ChatActionStatus;
  /** Structured body for propose→confirm cards. */
  proposal?: Record<string, unknown>;
  error?: string;
}

export type ChatRuntimeAccessMode =
  | "approval-required"
  | "auto-accept-edits"
  | "auto"
  | "full-access";

export type TerminalLineTone = "cmd" | "out" | "meta";

export interface TerminalLine {
  text: string;
  tone: TerminalLineTone;
}

export interface UpdateChatSessionInput {
  title?: string;
  named?: boolean;
  pinned?: boolean;
  settledOverride?: ChatSessionSettledOverride;
  runtime?: string;
  runtimeConfigurationId?: string | null;
  model?: string;
  reasoningEffort?: string;
  runtimeAlias?: string | null;
  fastMode?: boolean;
  runtimeAccessMode?: ChatRuntimeAccessMode;
  runtimeProfileId?: string;
}
