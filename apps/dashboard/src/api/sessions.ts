import type {
  ChatAbortDisposition,
  ChatActionPayload,
  ChatDelegationRunDto,
  ChatDocumentAttachment,
  ChatSessionLifecycle,
  ChatSessionScope,
  CreateTaskImageAttachment,
  UpdateChatSessionInput as SharedUpdateChatSessionInput,
  TerminalLine,
} from "@aop/common";
import { request } from "./request";

export interface ChatSessionSummary {
  id: string;
  scope: ChatSessionScope;
  repoId: string | null;
  repoName: string;
  repoPath: string;
  workspacePath: string;
  /** Live branch for this workspace when supplied by the server. */
  branch?: string | null;
  title: string;
  named: boolean;
  runtime: string;
  runtimeConfigurationId?: string | null;
  runtimeConfigurationName?: string | null;
  model: string;
  reasoningEffort: string;
  runtimeAlias: string | null;
  runtimeSessionId: string | null;
  fastMode: boolean;
  runtimeAccessMode?: import("@aop/common").ChatRuntimeAccessMode;
  defaultWorkerId?: string | null;
  defaultWorkflowId?: string | null;
  pinned: boolean;
  /** Explicit settlement pin. Null allows automatic settlement. */
  settledOverride: import("@aop/common").ChatSessionSettledOverride | null;
  /** Server timestamp for an accepted explicit settlement. */
  settledAt: string | null;
  /** Latest user or assistant activity used for automatic settlement. */
  lastActivityAt: string | null;
  /** Whether the session has an approval requiring user action. */
  hasPendingApproval?: boolean;
  assistantActive: boolean;
  /** Present on newer servers; prefer over assistantActive when available. */
  assistantLifecycle?: ChatSessionLifecycle;
  snippet: string | null;
  /** Assistant messages newer than the session read cursor. */
  unreadCount: number;
  updatedAt: string;
  createdAt: string;
}

/** @deprecated Prefer ChatActionPayload from @aop/common — alias kept for existing imports. */
export type ChatSessionAction = ChatActionPayload;

export interface ChatSessionMessageImage {
  id: string;
  mimeType: string;
  url: string;
}

export interface ChatSessionMessageDocument {
  id: string;
  mimeType: string;
  fileName: string;
  url: string;
}

export interface ChatSessionMessageArtifact {
  path: string;
  mimeType: "text/markdown";
}

export interface ChatSessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  action: ChatSessionAction | null;
  activity?: {
    thinking: string;
    content: string;
    commandGroups: Array<{
      id: string;
      commands: Array<{
        id: string;
        command: string;
        detail?: string;
        status: "running" | "done" | "failed";
        exitCode?: number | null;
      }>;
    }>;
  } | null;
  createdAt: string;
  images?: ChatSessionMessageImage[];
  documents?: ChatSessionMessageDocument[];
  artifacts?: ChatSessionMessageArtifact[];
  runStatus?: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  interruptionKind?: "steer" | "abort" | "reset" | null;
  failureKind?: "startup_timeout" | "empty_output" | null;
  contextStrategy?: "fresh" | "native_resume" | "aop_history" | null;
  workspacePath?: string | null;
  timeoutPolicy?: string | null;
  retryOfRunId?: string | null;
  disposition?: "immediate" | "queued" | "steered" | "retry";
  runId?: string;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatSessionMessage[];
  assistantActive: boolean;
  skills: string[];
}

export type UpdateChatSessionInput = SharedUpdateChatSessionInput;

export type { TerminalLine };

export const createChatSession = async (
  input: { repoId: string } | { scope: "general" },
): Promise<ChatSessionSummary> => {
  const data = await request<{ session: ChatSessionSummary }>("/chat-sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.session;
};

export const listChatSessions = async (): Promise<ChatSessionSummary[]> => {
  const data = await request<{ sessions: ChatSessionSummary[] }>("/chat-sessions");
  return data.sessions;
};

export const getChatSession = async (sessionId: string): Promise<ChatSessionDetail> => {
  const data = await request<{ session: ChatSessionDetail }>(`/chat-sessions/${sessionId}`);
  return data.session;
};

export interface ChatSessionLocation {
  worktreePath: string;
  branch: string | null;
}

export const getChatSessionLocation = async (sessionId: string): Promise<ChatSessionLocation> =>
  request<ChatSessionLocation>(`/chat-sessions/${sessionId}/location`);

export const setChatSessionWorkspace = async (
  sessionId: string,
  path: string | null,
): Promise<ChatSessionSummary> => {
  const data = await request<{ session: ChatSessionSummary }>(
    `/chat-sessions/${sessionId}/workspace`,
    path === null ? { method: "DELETE" } : { method: "PUT", body: JSON.stringify({ path }) },
  );
  return data.session;
};

export const abortChatSession = async (
  sessionId: string,
): Promise<{ aborted: boolean; disposition?: ChatAbortDisposition }> =>
  request<{ aborted: boolean; disposition?: ChatAbortDisposition }>(
    `/chat-sessions/${sessionId}/abort`,
    { method: "POST" },
  );

export interface ChatDelegationOutput {
  thinking: string;
  content: string;
  commandGroups: Array<{
    id: string;
    commands: Array<{
      id: string;
      command: string;
      detail?: string;
      status: "running" | "done" | "failed";
      exitCode?: number | null;
    }>;
  }>;
}

export const listActiveChatDelegations = async (): Promise<ChatDelegationRunDto[]> => {
  const data = await request<{ delegations: ChatDelegationRunDto[] }>(
    "/chat-sessions/delegations/active",
  );
  return data.delegations;
};

export const listChatDelegations = async (sessionId: string): Promise<ChatDelegationRunDto[]> => {
  const data = await request<{ delegations: ChatDelegationRunDto[] }>(
    `/chat-sessions/${sessionId}/delegations`,
  );
  return data.delegations;
};

export const getChatDelegationOutput = async (
  sessionId: string,
  delegationId: string,
): Promise<{ delegation: ChatDelegationRunDto; output: ChatDelegationOutput }> =>
  request<{ delegation: ChatDelegationRunDto; output: ChatDelegationOutput }>(
    `/chat-sessions/${sessionId}/delegations/${delegationId}/output`,
  );

export const resetChatSessionRuntime = async (
  sessionId: string,
): Promise<{ reset: boolean; clearedBinding: boolean; cancelledRun: boolean }> =>
  request<{ reset: boolean; clearedBinding: boolean; cancelledRun: boolean }>(
    `/chat-sessions/${sessionId}/reset-runtime`,
    { method: "POST" },
  );

export const updateChatSession = async (
  sessionId: string,
  input: UpdateChatSessionInput,
): Promise<ChatSessionSummary> => {
  const data = await request<{ session: ChatSessionSummary }>(`/chat-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.session;
};

export const markChatSessionRead = async (sessionId: string): Promise<ChatSessionSummary> => {
  const data = await request<{ session: ChatSessionSummary }>(
    `/chat-sessions/${sessionId}/mark-read`,
    { method: "POST" },
  );
  return data.session;
};

export const deleteChatSession = async (sessionId: string): Promise<void> => {
  await request<void>(`/chat-sessions/${sessionId}`, { method: "DELETE" });
};

export interface ChatPastePayload {
  index: number;
  lineCount: number;
  content: string;
}

export const sendChatMessage = async (
  sessionId: string,
  content: string,
  imageAttachments?: CreateTaskImageAttachment[],
  documentAttachments?: ChatDocumentAttachment[],
  midRunMode?: "queue" | "steer",
  workflowId?: string,
  runtimeActions?: import("@aop/common").ChatRuntimeActionSelection[],
  confirmToolInterrupt?: boolean,
  pastes?: ChatPastePayload[],
  workflowArmed?: boolean,
): Promise<{
  message: ChatSessionMessage;
  session: ChatSessionSummary;
  midRun?: "queued" | "steered";
  queued?: boolean;
  steered?: boolean;
}> => {
  return request<{
    message: ChatSessionMessage;
    session: ChatSessionSummary;
    midRun?: "queued" | "steered";
    queued?: boolean;
    steered?: boolean;
  }>(`/chat-sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify(
      buildSendChatMessageBody({
        content,
        imageAttachments,
        documentAttachments,
        midRunMode,
        workflowId,
        runtimeActions,
        confirmToolInterrupt,
        pastes,
        workflowArmed,
      }),
    ),
  });
};

const buildSendChatMessageBody = (input: {
  content: string;
  imageAttachments?: CreateTaskImageAttachment[];
  documentAttachments?: ChatDocumentAttachment[];
  midRunMode?: "queue" | "steer";
  workflowId?: string;
  runtimeActions?: import("@aop/common").ChatRuntimeActionSelection[];
  confirmToolInterrupt?: boolean;
  pastes?: ChatPastePayload[];
  workflowArmed?: boolean;
}): Record<string, unknown> => {
  const body: Record<string, unknown> = { content: input.content };
  setIfNonEmpty(body, "imageAttachments", input.imageAttachments);
  setIfNonEmpty(body, "documentAttachments", input.documentAttachments);
  setIfNonEmpty(body, "pastes", input.pastes);
  setIfNonEmpty(body, "runtimeActions", input.runtimeActions);
  if (input.midRunMode) body.midRunMode = input.midRunMode;
  if (input.workflowId) body.workflowId = input.workflowId;
  if (input.workflowArmed) body.workflowArmed = true;
  if (input.confirmToolInterrupt) body.confirmToolInterrupt = true;
  return body;
};

const setIfNonEmpty = (
  body: Record<string, unknown>,
  key: string,
  value: unknown[] | undefined,
) => {
  if (value && value.length > 0) body[key] = value;
};

export const retryChatRunFresh = async (
  sessionId: string,
  runId: string,
): Promise<{ message: ChatSessionMessage; session: ChatSessionSummary; existing: boolean }> =>
  request(`/chat-sessions/${sessionId}/runs/${runId}/retry-fresh`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true }),
  });

export const runChatSessionTerminal = async (
  sessionId: string,
  command: string,
): Promise<TerminalLine[]> => {
  const data = await request<{ lines: TerminalLine[] }>(`/chat-sessions/${sessionId}/terminal`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  return data.lines ?? [];
};

export const chatSessionStreamUrl = (sessionId: string): string =>
  `/api/chat-sessions/${sessionId}/stream`;
