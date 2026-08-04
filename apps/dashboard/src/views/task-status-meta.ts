import type { Task } from "../types";

export type TaskStatusBadgeVariant = "done" | "working" | "blocked" | "ready" | "draft";

export interface TaskStatusMeta {
  tag: string;
  /** Graphite badge variant (PLAN §4.1 functional color set). */
  variant: TaskStatusBadgeVariant;
}

const STATUS_META: Record<Task["status"], TaskStatusMeta> = {
  DRAFT: { tag: "To do", variant: "draft" },
  READY: { tag: "Ready", variant: "ready" },
  RESUMING: { tag: "Paused", variant: "ready" },
  WORKING: { tag: "Working", variant: "working" },
  PAUSED: { tag: "Paused", variant: "ready" },
  BLOCKED: { tag: "Needs you", variant: "blocked" },
  DONE: { tag: "Done", variant: "done" },
  REMOVED: { tag: "To do", variant: "draft" },
};

export const statusMeta = (status: Task["status"]): TaskStatusMeta =>
  STATUS_META[status] ?? STATUS_META.DRAFT;
