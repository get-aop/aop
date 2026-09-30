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
