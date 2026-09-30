interface SSERepo {
  id: string;
  name: string | null;
  path: string;
}

export interface SSEServerStatus {
  repos: SSERepo[];
}

export interface SSEInitEvent {
  type: "init";
  status: SSEServerStatus;
}

export interface SSERepoRemovedEvent {
  type: "repo-removed";
  repoId: string;
}

export interface SSEDataResetEvent {
  type: "data-reset";
}

export type ChatUnreadKind = "assistant-final" | "task-done" | "task-blocked";

export interface SSEChatUnreadEvent {
  type: "chat-unread";
  sessionId: string;
  title: string;
  snippet: string;
  kind: ChatUnreadKind;
}

export interface DashboardChatUnreadEvent {
  type: "chat-unread";
  data: Omit<SSEChatUnreadEvent, "type">;
}
