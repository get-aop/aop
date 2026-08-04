import type {
  ChatRuntimeAccessMode,
  ChatSessionLifecycle,
  ChatSessionScope,
  ChatSessionSettledOverride,
} from "./chat-session.ts";
import type { WorkflowRuntimeProvider, WorkflowRuntimeReasoning } from "./workflow-runtime.ts";

/**
 * The wire shape of a chat session. Shared so server responses, SSE payloads,
 * and dashboard state all describe a session with one contract instead of
 * per-app copies.
 */
export interface ChatSessionSummary {
  id: string;
  scope: ChatSessionScope;
  repoId: string | null;
  repoName: string;
  repoPath: string;
  title: string;
  named: boolean;
  runtime: WorkflowRuntimeProvider;
  runtimeConfigurationId: string | null;
  model: string;
  reasoningEffort: WorkflowRuntimeReasoning;
  runtimeAlias: string | null;
  runtimeSessionId: string | null;
  workspacePath: string;
  /** Live branch for list responses; absent on older servers and lightweight event payloads. */
  branch?: string | null;
  fastMode: boolean;
  runtimeAccessMode: ChatRuntimeAccessMode;
  defaultWorkerId: string | null;
  defaultWorkflowId: string | null;
  pinned: boolean;
  settledOverride: ChatSessionSettledOverride | null;
  settledAt: string | null;
  lastActivityAt: string | null;
  hasPendingApproval?: boolean;
  /** Backward-compatible busy flag. Prefer assistantLifecycle when present. */
  assistantActive: boolean;
  /** Explicit lifecycle for stop/steer capability and UI reconciliation. */
  assistantLifecycle: ChatSessionLifecycle;
  snippet: string | null;
  /** Assistant messages newer than last_read_at (or all when never read). */
  unreadCount: number;
  updatedAt: string;
  createdAt: string;
}
