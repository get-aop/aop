import type { ChatSessionDto } from "./service.ts";

/** Minimal session row fields needed for a lightweight ChatSessionDto. */
export type MinimalSessionRow = {
  id: string;
  repo_id: string | null;
  title: string;
  named: boolean | number;
  runtime: string;
  runtime_configuration_id: string | null;
  model: string;
  reasoning_effort: string;
  runtime_alias: string | null;
  runtime_session_id: string | null;
  workspace_path: string | null;
  fast_mode: boolean | number;
  runtime_access_mode?: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
  default_worker_id: string | null;
  default_workflow_id: string | null;
  pinned: boolean | number;
  settled_override: "settled" | "active" | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Lightweight ChatSessionDto for event fan-out (status notes, workspace binds).
 * Not a full list/detail projection — empty repo fields, zero unread.
 */
export const toMinimalSessionDto = (
  session: MinimalSessionRow,
  options?: { snippet?: string; updatedAt?: string },
): ChatSessionDto => ({
  id: session.id,
  scope: session.repo_id ? "repository" : "general",
  repoId: session.repo_id,
  repoName: "",
  repoPath: "",
  title: session.title,
  named: Boolean(session.named),
  runtime: session.runtime as ChatSessionDto["runtime"],
  runtimeConfigurationId: session.runtime_configuration_id,
  model: session.model,
  reasoningEffort: session.reasoning_effort as ChatSessionDto["reasoningEffort"],
  runtimeAlias: session.runtime_alias,
  runtimeSessionId: session.runtime_session_id,
  workspacePath: session.workspace_path ?? "",
  fastMode: Boolean(session.fast_mode),
  runtimeAccessMode: session.runtime_access_mode ?? "full-access",
  defaultWorkerId: session.default_worker_id,
  defaultWorkflowId: session.default_workflow_id,
  pinned: Boolean(session.pinned),
  settledOverride: session.settled_override,
  settledAt: session.settled_at,
  lastActivityAt: options?.updatedAt ?? null,
  assistantActive: false,
  assistantLifecycle: "idle",
  snippet: (options?.snippet ?? "").slice(0, 160),
  unreadCount: 0,
  updatedAt: options?.updatedAt ?? session.updated_at,
  createdAt: session.created_at,
});
