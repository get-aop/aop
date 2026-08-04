import type { DashboardSwimlane, TaskSwimlane } from "./dashboard-swimlanes.ts";
import type { RuntimeActivitySummary } from "./runtime-events.ts";
import type { TaskStatus } from "./task";

export type TaskDependencyState = "ready" | "waiting" | "blocked";
export type PlanReviewStatus = "corrections_queued" | "corrections_running" | "corrections_applied";
export type TaskCompletionMode = "pull_request" | "none";
export type SSEAgentRole = "developer" | "architect" | "reviewer" | "custom";

/**
 * SSE Task representation for wire protocol.
 * Uses camelCase and string dates for JSON serialization.
 */
export interface SSETask {
  id: string;
  repoId: string;
  changePath: string;
  /** Absolute path to task docs in AOP storage or legacy repo folder. */
  taskDocsPath?: string;
  status: TaskStatus;
  branchName?: string | null;
  baseBranch: string | null;
  preferredProvider: string | null;
  preferredWorkflow: string | null;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  assignedAgentRole?: SSEAgentRole | null;
  assignedAgentWorkflowId?: string | null;
  assignedAgentWorkflow?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  errorMessage?: string;
  currentExecutionId?: string;
  executionStartedAt?: string;
  executionCompletedAt?: string;
  taskProgress?: { completed: number; total: number };
  hasPlan?: boolean;
  dependencyState?: TaskDependencyState;
  blockedByTaskIds?: string[];
  blockedByRefs?: string[];
  swimlane?: TaskSwimlane;
  boardColumn?: "DRAFT" | "READY" | "IN_PROGRESS" | "DONE";
  runtimeActivity?: RuntimeActivitySummary;
  planReviewStatus?: PlanReviewStatus;
  completionMode?: TaskCompletionMode;
  sourceProvider?: string | null;
  sourceRef?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

/**
 * Dashboard-friendly task with resolved repoPath.
 * Extends SSETask with the path needed for UI display.
 */
export interface DashboardTask extends SSETask {
  repoPath: string;
}

export interface SSERepo {
  id: string;
  name: string | null;
  path: string;
}

export interface SSERepoWithTasks extends SSERepo {
  working: number;
  max: number;
  tasks: SSETask[];
}

export interface SSEServerStatus {
  swimlanes: DashboardSwimlane[];
  repos: SSERepoWithTasks[];
}

export type SSEEventType =
  | "init"
  | "task-created"
  | "task-status-changed"
  | "task-updated"
  | "task-removed"
  | "repo-removed"
  | "data-reset"
  | "chat-unread"
  | "heartbeat";

export interface SSEInitEvent {
  type: "init";
  status: SSEServerStatus;
}

export interface SSETaskCreatedEvent {
  type: "task-created";
  task: SSETask;
}

export interface SSETaskStatusChangedEvent {
  type: "task-status-changed";
  taskId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  task: SSETask;
}

export interface SSETaskUpdatedEvent {
  type: "task-updated";
  taskId: string;
  task: SSETask;
}

export interface SSETaskRemovedEvent {
  type: "task-removed";
  taskId: string;
  task: SSETask;
}

export interface SSERepoRemovedEvent {
  type: "repo-removed";
  repoId: string;
}

export interface SSEDataResetEvent {
  type: "data-reset";
}

export interface SSEHeartbeatEvent {
  type: "heartbeat";
  timestamp: string;
}

export type ChatUnreadKind = "assistant-final" | "task-done" | "task-blocked";

export interface SSEChatUnreadEvent {
  type: "chat-unread";
  sessionId: string;
  title: string;
  snippet: string;
  kind: ChatUnreadKind;
}

export type SSEEvent =
  | SSEInitEvent
  | SSETaskCreatedEvent
  | SSETaskStatusChangedEvent
  | SSETaskUpdatedEvent
  | SSETaskRemovedEvent
  | SSERepoRemovedEvent
  | SSEDataResetEvent
  | SSEChatUnreadEvent
  | SSEHeartbeatEvent;

/**
 * Dashboard-specific event types with resolved repoPath on tasks.
 * Used by the frontend after transforming wire events.
 */
export interface DashboardInitEvent {
  type: "init";
  data: {
    tasks: DashboardTask[];
    swimlanes: DashboardSwimlane[];
    repos: SSERepo[];
  };
}

export interface DashboardTaskCreatedEvent {
  type: "task-created";
  data: { task: DashboardTask };
}

export interface DashboardTaskStatusChangedEvent {
  type: "task-status-changed";
  data: {
    taskId: string;
    status: TaskStatus;
    updatedAt: string;
    errorMessage?: string;
    currentExecutionId?: string;
    executionStartedAt?: string;
    executionCompletedAt?: string;
    taskProgress?: { completed: number; total: number };
    hasPlan?: boolean;
    swimlane?: TaskSwimlane;
    boardColumn?: "DRAFT" | "READY" | "IN_PROGRESS" | "DONE";
    runtimeActivity?: RuntimeActivitySummary;
    completionMode?: TaskCompletionMode;
    assignedAgentRole?: SSEAgentRole | null;
  };
}

export interface DashboardTaskUpdatedEvent {
  type: "task-updated";
  data: { taskId: string; archivedAt: string | null; updatedAt: string };
}

export interface DashboardTaskRemovedEvent {
  type: "task-removed";
  data: { taskId: string };
}

export interface DashboardHeartbeatEvent {
  type: "heartbeat";
  data: { timestamp: string };
}

export interface DashboardChatUnreadEvent {
  type: "chat-unread";
  data: Omit<SSEChatUnreadEvent, "type">;
}

export interface DashboardRepoRemovedEvent {
  type: "repo-removed";
  data: { repoId: string };
}

export interface DashboardDataResetEvent {
  type: "data-reset";
  data: Record<string, never>;
}

export type DashboardEvent =
  | DashboardInitEvent
  | DashboardTaskCreatedEvent
  | DashboardTaskStatusChangedEvent
  | DashboardTaskUpdatedEvent
  | DashboardTaskRemovedEvent
  | DashboardRepoRemovedEvent
  | DashboardDataResetEvent
  | DashboardChatUnreadEvent
  | DashboardHeartbeatEvent;
