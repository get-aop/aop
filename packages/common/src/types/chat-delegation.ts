/**
 * Specialist / background runs that execute inside a host chat turn.
 * Includes AOP-owned `%` delegations and quick actions, plus model-spawned
 * Task/Agent background tools projected from the host stream. State is a
 * JSON array on the host `chat_runs` row.
 */

export type ChatDelegationKind = "delegation" | "quick-action" | "background-task";

/** Maximum background-task history retained for one chat session. */
export const BACKGROUND_TASK_LIMIT = 5;

/** Persisted lifecycle. Presentation adds starting/working/waiting on top. */
export type ChatDelegationStatus = "active" | "completed" | "failed" | "cancelled";

export interface ChatDelegationRun {
  id: string;
  kind: ChatDelegationKind;
  /** Human label for the run, e.g. "Review", "Implement", or a Task description. */
  label: string;
  runtime: string;
  runtimeAlias: string | null;
  runtimeConfigurationId: string | null;
  model: string;
  reasoning: string;
  fastMode: boolean;
  status: ChatDelegationStatus;
  /** Short current activity derived from real runtime events. */
  activity: string | null;
  /** The specialist's provider runtime session id (never the host's). */
  runtimeSessionId: string | null;
  logFilePath: string;
  error: string | null;
  /**
   * Host-stream tool_use id for model-spawned background tasks. Used to
   * correlate start/finish without double-registering after reconnect.
   */
  toolUseId?: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Wire shape for SSE events and REST reads: entry plus its host context. */
export interface ChatDelegationRunDto extends ChatDelegationRun {
  hostRunId: string;
  hostRunStatus: string;
  sessionId: string;
  sessionTitle: string | null;
}
