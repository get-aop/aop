import { describe, expect, test } from "bun:test";
import {
  buildActionFromCreatedTask,
  buildBatchActionFromCreatedTasks,
} from "./create-task-action.ts";

describe("buildActionFromCreatedTask", () => {
  test("builds the shared task-assignment card payload", () => {
    expect(
      buildActionFromCreatedTask({
        taskId: "task_created",
        title: "Created task",
        repoId: "repo_1",
        workerId: "worker_1",
        workflowId: "workflow_1",
        workflowName: "Review workflow",
      }),
    ).toEqual({
      type: "task-assignment",
      id: "task_created",
      label: "Task created",
      sub: "Created task",
      meta: "Backlog",
      status: "live",
      proposal: {
        taskIds: ["task_created"],
        title: "Created task",
        repoId: "repo_1",
        workerId: "worker_1",
        workflowId: "workflow_1",
        workflowName: "Review workflow",
      },
    });
  });
});

describe("buildBatchActionFromCreatedTasks", () => {
  test("maps every task to an item in order and carries prefills", () => {
    const action = buildBatchActionFromCreatedTasks(
      [
        {
          taskId: "task_a",
          title: "First task",
          workerId: "worker_1",
          workflowId: "workflow_1",
          workflowName: "Review workflow",
        },
        { taskId: "task_b", title: "Second task" },
        { taskId: "task_c", title: "Third task", workerId: null, workflowId: null },
      ],
      "repo_1",
    );

    expect(action).toEqual({
      type: "task-batch-assignment",
      label: "3 tasks created",
      sub: "First task +2 more",
      meta: "Backlog",
      status: "live",
      proposal: {
        repoId: "repo_1",
        items: [
          {
            taskId: "task_a",
            title: "First task",
            workerId: "worker_1",
            workflowId: "workflow_1",
            workflowName: "Review workflow",
          },
          {
            taskId: "task_b",
            title: "Second task",
            workerId: null,
            workflowId: null,
            workflowName: null,
          },
          {
            taskId: "task_c",
            title: "Third task",
            workerId: null,
            workflowId: null,
            workflowName: null,
          },
        ],
      },
    });
  });

  test("single-task batches keep singular label and plain sub", () => {
    const action = buildBatchActionFromCreatedTasks(
      [{ taskId: "task_only", title: "Only task" }],
      "repo_1",
    );

    expect(action.label).toBe("1 task created");
    expect(action.sub).toBe("Only task");
  });
});
