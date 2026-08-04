import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useEffect } from "react";
import { setupDashboardDom } from "../test/setup-dom";
import type { Execution, Task } from "../types";

setupDashboardDom();

const LOGS_REPO_ID = "repo-logs";
const LOGS_TASK_ID = "task-logs";

class ImmediateReplayEventSource {
  static instances: ImmediateReplayEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    ImmediateReplayEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);

    if (type === "message") {
      const executionId = this.url.match(/\/api\/executions\/([^/]+)\/logs$/)?.[1];
      const lines = executionId ? (replayLinesByExecutionId[executionId] ?? []) : [];
      if (lines.length === 0) return;

      listener({
        data: JSON.stringify({
          type: "replay",
          lines,
        }),
      } as MessageEvent);
    }
  }

  close() {}
}

const makeExecution = (id: string, startedAt: string): Execution => ({
  id,
  taskId: LOGS_TASK_ID,
  status: "completed" as const,
  startedAt,
  finishedAt: "2026-04-01T00:01:00.000Z",
  steps: [
    {
      id: `step-${id}`,
      stepId: "implement",
      stepType: "implement",
      status: "success" as const,
      startedAt,
      endedAt: "2026-04-01T00:01:00.000Z",
    },
  ],
});

let mockExecutions = [makeExecution("exec-1", "2026-04-01T00:00:00.000Z")];
let mockFiles = ["task.md"];
let replayLinesByExecutionId: Record<
  string,
  Array<{ stream: string; content: string; timestamp: string }>
> = {
  "exec-1": [
    {
      stream: "stdout",
      content: "hello from replay",
      timestamp: "2026-04-01T00:00:00.000Z",
    },
  ],
};

const mockUseTaskEvents = mock(() => ({
  tasks: [
    {
      id: LOGS_TASK_ID,
      repoId: LOGS_REPO_ID,
      repoPath: "/tmp/repo",
      changePath: "docs/tasks/test-task",
      status: "DONE" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T01:00:00Z",
      currentExecutionId: null,
      baseBranch: null,
      preferredProvider: null,
      preferredWorkflow: null,
      executionStartedAt: null,
      executionCompletedAt: null,
      taskProgress: null,
    },
  ],
  capacity: { working: 0, max: 3 },
  repos: [],
  connected: true,
  initialized: true,
  refresh: mock(),
}));

mock.module("../hooks/useTaskEvents", () => ({
  useTaskEvents: mockUseTaskEvents,
}));

mock.module("../hooks/useSSE", () => ({
  useSSE: ({
    onMessage,
    url,
  }: {
    onMessage?: (
      eventType: string,
      data: {
        type: "replay";
        lines: Array<{ stream: string; content: string; timestamp: string }>;
      },
    ) => void;
    url: string | null;
  }) => {
    useEffect(() => {
      if (!url) return;

      const executionId = url.match(/\/api\/executions\/([^/]+)\/logs$/)?.[1];
      const lines = executionId ? (replayLinesByExecutionId[executionId] ?? []) : [];
      if (lines.length > 0) onMessage?.("message", { type: "replay", lines });
    }, [onMessage, url]);

    return { connected: Boolean(url), error: null };
  },
}));

const requestJson = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
};

const isLogsTask = (repoId: string, taskId: string): boolean =>
  repoId === LOGS_REPO_ID && taskId === LOGS_TASK_ID;

mock.module("../api/specs-client", () => ({
  fetchChangeFiles: async (repoId: string, taskId: string) => {
    if (isLogsTask(repoId, taskId)) return mockFiles;
    const data = await requestJson<{ files: string[] }>(
      `/api/repos/${repoId}/tasks/${taskId}/files`,
    );
    return data.files;
  },
  fetchChangeFile: async (repoId: string, taskId: string, path: string) => {
    if (!isLogsTask(repoId, taskId)) {
      const data = await requestJson<{ content: string }>(
        `/api/repos/${repoId}/tasks/${taskId}/files/${encodeURIComponent(path)}`,
      );
      return data.content;
    }
    if (path === "task.md") return "# Task";
    if (path === "plan.md") return "# Plan\n\nGenerated plan for review.";
    if (path === "issues.md") return "# Issues\n\nGenerated issues for review.";
    throw new Error("File not found");
  },
  fetchReviewNotes: async (repoId: string, taskId: string) => {
    if (isLogsTask(repoId, taskId)) return [];
    const data = await requestJson<{ notes: unknown[] }>(
      `/api/repos/${repoId}/tasks/${taskId}/review-notes`,
    );
    return data.notes;
  },
  createReviewNote: async (
    repoId: string,
    taskId: string,
    input: {
      filePath: string;
      selectedText: string;
      textOccurrence?: number;
      note: string;
    },
  ) => {
    if (isLogsTask(repoId, taskId)) {
      throw new Error("createReviewNote is not used in TaskDetail logs tests");
    }
    const data = await requestJson<{ note: unknown }>(
      `/api/repos/${repoId}/tasks/${taskId}/review-notes`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return data.note;
  },
  updateReviewNote: async (
    repoId: string,
    taskId: string,
    noteId: string,
    input: { note: string },
  ) => {
    if (isLogsTask(repoId, taskId)) {
      throw new Error("updateReviewNote is not used in TaskDetail logs tests");
    }
    const data = await requestJson<{ note: unknown }>(
      `/api/repos/${repoId}/tasks/${taskId}/review-notes/${noteId}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return data.note;
  },
  deleteReviewNote: async (repoId: string, taskId: string, noteId: string) => {
    if (isLogsTask(repoId, taskId)) {
      throw new Error("deleteReviewNote is not used in TaskDetail logs tests");
    }
    await requestJson<{ ok: true }>(`/api/repos/${repoId}/tasks/${taskId}/review-notes/${noteId}`, {
      method: "DELETE",
    });
  },
  submitReviewNotes: async (repoId: string, taskId: string) => {
    if (isLogsTask(repoId, taskId)) {
      return { filePath: "issues.md", submittedCount: 0, regenerating: false };
    }
    return requestJson<{ filePath: string; submittedCount: number; regenerating: boolean }>(
      `/api/repos/${repoId}/tasks/${taskId}/review-notes/submit`,
      { method: "POST" },
    );
  },
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const taskDetailModulePath = "./TaskDetail.tsx?logs-test";
const { TaskDetail } = (await import(taskDetailModulePath)) as typeof import("./TaskDetail");

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;

const mockTaskDetailFetch = (input: RequestInfo | URL): Response => {
  const url = String(input);

  if (url.endsWith(`/api/repos/${LOGS_REPO_ID}/tasks/${LOGS_TASK_ID}/executions`)) {
    return new Response(
      JSON.stringify({
        executions: mockExecutions,
      }),
      { status: 200 },
    );
  }

  if (url.endsWith("/api/workflows")) {
    return new Response(JSON.stringify({ workflows: ["aop-default-gpt"] }), { status: 200 });
  }

  if (url.endsWith(`/api/repos/${LOGS_REPO_ID}/tasks/${LOGS_TASK_ID}/review-notes`)) {
    return new Response(JSON.stringify({ notes: [] }), { status: 200 });
  }

  return new Response(JSON.stringify({}), { status: 200 });
};

beforeEach(() => {
  ImmediateReplayEventSource.instances = [];
  mockExecutions = [makeExecution("exec-1", "2026-04-01T00:00:00.000Z")];
  mockFiles = ["task.md"];
  replayLinesByExecutionId = {
    "exec-1": [
      {
        stream: "stdout",
        content: "hello from replay",
        timestamp: "2026-04-01T00:00:00.000Z",
      },
    ],
  };
  globalThis.EventSource = ImmediateReplayEventSource as unknown as typeof EventSource;
  globalThis.fetch = mock((input: RequestInfo | URL) =>
    Promise.resolve(mockTaskDetailFetch(input)),
  ) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
});

const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: LOGS_TASK_ID,
  repoId: LOGS_REPO_ID,
  repoPath: "/tmp/repo",
  changePath: "docs/tasks/test-task",
  status: "DONE" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T01:00:00Z",
  currentExecutionId: undefined,
  baseBranch: null,
  preferredProvider: null,
  preferredWorkflow: null,
  executionStartedAt: undefined,
  executionCompletedAt: undefined,
  taskProgress: undefined,
  ...overrides,
});

const buildDraftTaskWithExecution = (overrides: Partial<Task> = {}): Task => ({
  ...buildTask(),
  status: "DRAFT" as const,
  currentExecutionId: "exec-implementation",
  ...overrides,
});

describe("TaskDetail logs", () => {
  test("keeps replayed logs for completed executions", async () => {
    render(<TaskDetail taskId={LOGS_TASK_ID} tasks={[buildTask()]} onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("tab-logs"));

    await waitFor(() =>
      expect(screen.getByTestId("log-viewer").textContent).toContain("hello from replay"),
    );
    expect(screen.getByTestId("log-viewer").textContent).not.toContain("Waiting for logs...");
  });

  test("keeps the latest completed execution selected when history renders oldest first", async () => {
    mockExecutions = [
      makeExecution("exec-2", "2026-04-01T00:02:00.000Z"),
      makeExecution("exec-1", "2026-04-01T00:00:00.000Z"),
    ];
    replayLinesByExecutionId = {
      "exec-2": [
        {
          stream: "stdout",
          content: "latest execution replay",
          timestamp: "2026-04-01T00:02:00.000Z",
        },
      ],
    };

    render(<TaskDetail taskId={LOGS_TASK_ID} tasks={[buildTask()]} onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("tab-logs"));

    await waitFor(() => expect(screen.getByTestId("execution-item-exec-1")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("log-viewer").textContent).toContain("latest execution replay"),
    );
    expect(screen.getByTestId("log-viewer").textContent).not.toContain("Waiting for logs...");
  });

  test("opens draft tasks on logs until a spec doc exists", async () => {
    mockFiles = [];
    mockExecutions = [
      {
        ...makeExecution("exec-implementation", "2026-04-01T00:00:00.000Z"),
        status: "running" as const,
        finishedAt: undefined,
        steps: [
          {
            id: "step-implementation",
            stepId: "implement",
            stepType: "implement",
            status: "running" as const,
            startedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    ];
    replayLinesByExecutionId = {
      "exec-implementation": [
        {
          stream: "stdout",
          content: "implementation is running",
          timestamp: "2026-04-01T00:00:00.000Z",
        },
      ],
    };

    render(
      <TaskDetail
        taskId={LOGS_TASK_ID}
        tasks={[buildDraftTaskWithExecution()]}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("log-viewer").textContent).toContain("implementation is running"),
    );
    await waitFor(() => expect(screen.queryByTestId("tab-specs")).toBeNull());
  });

  test("opens draft tasks on specs once issues.md exists", async () => {
    mockFiles = ["issues.md"];
    mockExecutions = [
      {
        ...makeExecution("exec-implementation", "2026-04-01T00:00:00.000Z"),
        status: "completed" as const,
      },
    ];

    render(
      <TaskDetail
        taskId={LOGS_TASK_ID}
        tasks={[buildDraftTaskWithExecution()]}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("specs-tab")).toBeDefined());
    expect(screen.getByTestId("tab-specs").getAttribute("aria-selected")).toBe("true");
    await waitFor(() =>
      expect(screen.getByTestId("specs-tab").textContent).toContain("Generated issues for review."),
    );
  });

  test("allows viewing specs while a task execution is running", async () => {
    mockFiles = ["issues.md"];
    mockExecutions = [
      {
        ...makeExecution("exec-implementation", "2026-04-01T00:00:00.000Z"),
        status: "running" as const,
        finishedAt: undefined,
        steps: [
          {
            id: "step-implementation",
            stepId: "implement",
            stepType: "implement",
            status: "running" as const,
            startedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    ];
    replayLinesByExecutionId = {
      "exec-implementation": [
        {
          stream: "stdout",
          content: "implementation is running",
          timestamp: "2026-04-01T00:00:00.000Z",
        },
      ],
    };

    render(
      <TaskDetail
        taskId={LOGS_TASK_ID}
        tasks={[
          buildTask({
            status: "WORKING" as const,
            currentExecutionId: "exec-implementation",
          }),
        ]}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("tab-logs").getAttribute("aria-selected")).toBe("true"),
    );

    fireEvent.mouseDown(screen.getByTestId("tab-specs"), { button: 0, ctrlKey: false });

    await waitFor(() =>
      expect(screen.getByTestId("tab-specs").getAttribute("aria-selected")).toBe("true"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("specs-tab").textContent).toContain("Generated issues for review."),
    );
  });
});
