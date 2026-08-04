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
export type ChatActionType =
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

export type ChatActionStatus = "proposed" | "confirmed" | "stale" | "error" | "live";

export interface TaskAssignmentCandidate {
  id: string;
  title: string;
}

export interface TaskAssignmentFields {
  /** Confirmed / fixed selection (or initial multi-select). */
  taskIds: string[];
  title?: string;
  repoId: string;
  workerId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  /**
   * When set, the assignment card shows a multi-select checklist among these
   * backlog candidates. `taskIds` is the initial selection (often empty).
   */
  candidates?: TaskAssignmentCandidate[];
}

export type TaskBatchRoutedOutcome = "backlog" | "assigned" | "started";

export interface TaskBatchAssignmentItem {
  taskId: string;
  title: string;
  /** Prefill for the row's destination select — never auto-assigns. */
  workerId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  /** Set after the user routes this row; restores UI after reopen/refresh. */
  routedOutcome?: TaskBatchRoutedOutcome;
  /** Worker chosen when routedOutcome is assigned or started. */
  routedWorkerId?: string | null;
}

export interface TaskBatchAssignmentFields {
  repoId: string;
  items: TaskBatchAssignmentItem[];
}

export type ChatRuntimeActionIntent = "implement" | "review" | "audit" | "test" | "security";

export interface ChatRuntimeActionSelection {
  id: string;
  intent: ChatRuntimeActionIntent;
  runtimeConfigurationId: string;
  runtimeConfigurationName?: string;
  provider: import("./workflow-runtime.ts").WorkflowRuntimeProvider;
  model: string;
  reasoning: import("./workflow-runtime.ts").WorkflowRuntimeReasoning;
  fastMode: boolean;
  phase: "writer" | "post-work";
}

export interface ChatWorkflowSelection {
  workflowId: string;
  name: string;
  stepCount: number;
  stepTypes?: string[];
  steps?: Array<{
    id: string;
    type: string;
    provider?: string;
    model?: string;
    reasoning?: string;
    fastMode?: boolean;
  }>;
}

export interface WorkflowRunFields {
  workflowId: string;
  workflowName: string;
  stepCount: number;
}

export interface RuntimeActionsFields {
  actions: ChatRuntimeActionSelection[];
}

export interface WorkflowPreviewFields {
  name: string;
  workflowId?: string | null;
  steps: Array<{
    id: string;
    type: string;
    model?: string | null;
    provider?: string | null;
  }>;
  /** JSON patch / draft definition for save (opaque to the card). */
  definition?: unknown;
}

export interface ApprovalCardFields {
  handoffId: string;
  taskId: string;
  title: string;
  repoId?: string;
  fromStep?: string | null;
  toStep?: string | null;
}

export interface ChatActionPayload {
  type: ChatActionType;
  id?: string;
  label: string;
  sub: string;
  meta: string;
  status?: ChatActionStatus;
  /** Structured body for propose→confirm cards. */
  proposal?:
    | TaskAssignmentFields
    | TaskBatchAssignmentFields
    | WorkflowPreviewFields
    | ApprovalCardFields
    | WorkflowRunFields
    | RuntimeActionsFields
    | Record<string, unknown>;
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
  /** Composer context chip: preferred worker for this session. */
  defaultWorkerId?: string | null;
  /** Composer context chip: preferred workflow for this session. */
  defaultWorkflowId?: string | null;
}

/** Known propose tools that never mutate until a REST confirm. */
export const AOP_MCP_PROPOSE_TOOLS = [] as const;

export const AOP_MCP_MUTATION_TOOLS = ["aop_set_chat_workspace"] as const;

export const AOP_MCP_READ_TOOLS = ["aop_list_workflows", "aop_list_repos"] as const;

export type AopMcpProposeTool = (typeof AOP_MCP_PROPOSE_TOOLS)[number];
export type AopMcpReadTool = (typeof AOP_MCP_READ_TOOLS)[number];
export type AopMcpMutationTool = (typeof AOP_MCP_MUTATION_TOOLS)[number];
