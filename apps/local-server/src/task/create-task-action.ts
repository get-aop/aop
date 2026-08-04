import type { ChatActionPayload } from "@aop/common";

export interface CreatedTaskActionInput {
  taskId: string;
  title: string;
  repoId: string;
  workerId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
}

export interface BatchCreatedTaskInput {
  taskId: string;
  title: string;
  workerId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
}

export const buildActionFromCreatedTask = (input: CreatedTaskActionInput): ChatActionPayload => ({
  type: "task-assignment",
  id: input.taskId,
  label: "Task created",
  sub: input.title,
  meta: "Backlog",
  status: "live",
  proposal: {
    taskIds: [input.taskId],
    title: input.title,
    repoId: input.repoId,
    workerId: input.workerId ?? null,
    workflowId: input.workflowId ?? null,
    workflowName: input.workflowName ?? null,
  },
});

/** One routing-board card aggregating every task a batch run persisted. */
export const buildBatchActionFromCreatedTasks = (
  tasks: BatchCreatedTaskInput[],
  repoId: string,
): ChatActionPayload => ({
  type: "task-batch-assignment",
  label: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} created`,
  sub: tasks.length > 1 ? `${tasks[0]?.title} +${tasks.length - 1} more` : (tasks[0]?.title ?? ""),
  meta: "Backlog",
  status: "live",
  proposal: {
    repoId,
    items: tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      workerId: task.workerId ?? null,
      workflowId: task.workflowId ?? null,
      workflowName: task.workflowName ?? null,
    })),
  },
});
