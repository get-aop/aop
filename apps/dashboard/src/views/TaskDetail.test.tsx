import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeEvent } from "@aop/common";
import type { ReactElement } from "react";
import { setupDashboardDom } from "../test/setup-dom";
import type { Execution, Task } from "../types";

setupDashboardDom();

HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close ??= function close() {
  this.open = false;
};

Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/tmp/aop-mono",
  changePath: "docs/tasks/test-task",
  status: "DRAFT",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T01:00:00Z",
  currentExecutionId: undefined,
  baseBranch: "main",
  preferredProvider: "codex-cli",
  preferredWorkflow: null,
  assignedAgentWorkflowId: "workflow-implement",
  assignedAgentWorkflow: "aop-implement",
  assignedAgentId: "agent-bolt",
  assignedAgentName: "Bolt",
  errorMessage: undefined,
  executionStartedAt: undefined,
  executionCompletedAt: undefined,
  taskProgress: undefined,
  sourceProvider: "linear",
  sourceRef: "GET-57",
  sourceTitle: "Redesign the task detail route",
  runtimeActivity: {
    sessionId: "pi-session-57",
    sessionState: "idle",
    latestEventKind: "handoff_produced",
    latestEventAt: "2026-01-01T01:00:00Z",
    latestMessage: "Handoff ready for review.",
    needsAttention: false,
    blocked: false,
    handoffProduced: true,
    verificationEvidenceRecorded: true,
  },
  ...overrides,
});

const makeExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: "exec-1",
  taskId: "task-1",
  status: "completed",
  startedAt: "2026-04-01T00:00:00.000Z",
  finishedAt: "2026-04-01T00:01:00.000Z",
  steps: [
    {
      id: "step-1",
      stepId: "implement",
      stepType: "implement",
      status: "success",
      startedAt: "2026-04-01T00:00:00.000Z",
      endedAt: "2026-04-01T00:01:00.000Z",
    },
  ],
  ...overrides,
});

let currentTasks: Task[] = [buildTask()];
let currentExecutions: Execution[] = [];
let currentRuntimeEvents: RuntimeEvent[] = [];
let currentExecutionUsage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
} = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, durationMs: 0 };
let currentReviewNotes: Array<{
  id: string;
  filePath: string;
  selectedText: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}> = [];

mock.module("../hooks/useSSE", () => ({
  useSSE: () => ({ connected: false }),
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { TaskDetail } = await import("./TaskDetail");

const originalFetch = globalThis.fetch;

const mockTaskDetailFetch = (url: string): Response => {
  if (url.endsWith("/api/workflows")) {
    return new Response(JSON.stringify({ workflows: ["aop-plan", "aop-implement"] }), {
      status: 200,
    });
  }

  if (url.includes("/review-notes")) {
    return new Response(JSON.stringify({ notes: currentReviewNotes }), { status: 200 });
  }

  if (url.endsWith("/api/repos/repo-1/tasks/task-1/executions")) {
    return new Response(JSON.stringify({ executions: currentExecutions }), { status: 200 });
  }

  if (url.endsWith("/api/executions/exec-1/runtime-events")) {
    return new Response(JSON.stringify({ events: currentRuntimeEvents }), { status: 200 });
  }

  if (url.endsWith("/api/executions/exec-1/usage")) {
    return new Response(JSON.stringify({ usage: [], totals: currentExecutionUsage }), {
      status: 200,
    });
  }

  if (url.endsWith("/api/repos/repo-1/tasks/task-1/files")) {
    return new Response(JSON.stringify({ files: ["issues.md", "plan.md"] }), { status: 200 });
  }

  if (url.endsWith("/api/repos/repo-1/tasks/task-1/files/issues.md")) {
    return new Response(JSON.stringify({ content: "# Issues\n\nGenerated issues for review." }), {
      status: 200,
    });
  }

  if (url.endsWith("/api/repos/repo-1/tasks/task-1/files/plan.md")) {
    return new Response(JSON.stringify({ content: "# Plan" }), { status: 200 });
  }

  if (url.endsWith("/api/repos/repo-1/tasks/task-1/review-notes")) {
    return new Response(JSON.stringify({ notes: [] }), { status: 200 });
  }

  return new Response(JSON.stringify({}), { status: 200 });
};

beforeEach(() => {
  currentTasks = [buildTask()];
  currentExecutions = [];
  currentRuntimeEvents = [];
  currentExecutionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
  currentReviewNotes = [];
  globalThis.fetch = mock((input: RequestInfo | URL) =>
    Promise.resolve(mockTaskDetailFetch(String(input))),
  ) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const renderDetailMarkup = (taskId = "task-1", tasks: Task[] = currentTasks) => {
  return renderToString(<TaskDetail taskId={taskId} tasks={tasks} onClose={() => {}} />);
};

const renderDetail = (taskId = "task-1", tasks: Task[] = currentTasks) => {
  return render(<TaskDetail taskId={taskId} tasks={tasks} onClose={() => {}} />);
};

const settleTaskDetailEffects = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("TaskDetail scroll layout", () => {
  test("locks task detail to the viewport height", async () => {
    const html = await renderDetailMarkup();

    expect(html).toContain('data-testid="task-detail"');
    expect(html).toContain("flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas");
  });

  test("main content area fills remaining space without growing the page", async () => {
    const html = await renderDetailMarkup();

    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-hidden");
  });

  test("specs tab scrolls inside the remaining panel", async () => {
    const html = await renderDetailMarkup();

    expect(html).toContain("min-h-0 flex-1 overflow-auto");
  });
});

describe("TaskDetail operational redesign", () => {
  test("renders repository, workflow, runtime, and assignee context up front", async () => {
    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByRole("heading", { name: "test-task" })).toBeDefined();
    expect(screen.getByText("Repository")).toBeDefined();
    expect(screen.getByText("aop-mono")).toBeDefined();
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("aop-implement")).toBeDefined();
    expect(screen.getByText("Runtime")).toBeDefined();
    expect(screen.getByText("No session")).toBeDefined();
    expect(screen.getByText("Assignee")).toBeDefined();
    expect(screen.getByText("Bolt")).toBeDefined();
  });

  test("shows the task workflow metadata without a studio link (PLAN §7.3)", async () => {
    currentTasks = [
      buildTask({
        assignedAgentWorkflowId: "workflow-db-2",
        assignedAgentWorkflow: "Frontend polish",
      }),
    ];
    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByText("Frontend polish")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Frontend polish" })).toBeNull();
  });

  test("shows running runtime while task is working even if the last tool event completed", async () => {
    const runtimeActivity = buildTask().runtimeActivity as NonNullable<Task["runtimeActivity"]>;
    currentTasks = [
      buildTask({
        status: "WORKING",
        currentExecutionId: "exec-1",
        runtimeActivity: { ...runtimeActivity, sessionState: "completed" },
      }),
    ];

    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByText("running")).toBeDefined();
  });

  test("keeps the meta strip free of large runtime log blobs", async () => {
    const longMessage = "log chunk ".repeat(80);
    const task = buildTask();
    const runtimeActivity = task.runtimeActivity as NonNullable<Task["runtimeActivity"]>;
    currentTasks = [
      buildTask({
        runtimeActivity: {
          ...runtimeActivity,
          sessionState: "completed",
          latestMessage: longMessage,
        },
      }),
    ];

    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.queryByText(/log chunk log chunk/)).toBeNull();
    expect(screen.getByText("No session")).toBeDefined();
  });

  test("shows verification evidence in the execution proof panel", async () => {
    currentExecutions = [makeExecution()];
    currentRuntimeEvents = [
      {
        id: "event-evidence-1",
        taskId: "task-1",
        executionId: "exec-1",
        stepExecutionId: "step-1",
        sessionId: null,
        agentId: null,
        kind: "verification_evidence_recorded",
        title: "Verification passed",
        message:
          "Verification command passed: bun test apps/local-server/src/workflow/service.test.ts",
        toolName: null,
        status: "passed",
        occurredAt: "2026-04-01T00:01:00.000Z",
        metadata: {
          evidence: {
            kind: "test_command",
            command: "bun test apps/local-server/src/workflow/service.test.ts",
            status: "passed",
            exitCode: 0,
            startedAt: "2026-04-01T00:00:50.000Z",
            endedAt: "2026-04-01T00:01:00.000Z",
            summary: "18 tests passed",
          },
        },
      },
    ];

    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByText("Execution proof")).toBeDefined();
    expect(screen.getByText("test_command")).toBeDefined();
    expect(screen.getByText("18 tests passed")).toBeDefined();
    expect(
      screen.getByText("bun test apps/local-server/src/workflow/service.test.ts"),
    ).toBeDefined();
  });

  test("shows spend stats when usage data is available", async () => {
    currentExecutions = [makeExecution()];
    currentRuntimeEvents = [
      {
        id: "event-evidence-1",
        taskId: "task-1",
        executionId: "exec-1",
        stepExecutionId: "step-1",
        sessionId: null,
        agentId: null,
        kind: "verification_evidence_recorded",
        title: "Verification passed",
        message: "passed",
        toolName: null,
        status: "passed",
        occurredAt: "2026-04-01T00:01:00.000Z",
        metadata: {
          evidence: {
            kind: "test_command",
            command: "bun test",
            status: "passed",
            exitCode: 0,
            startedAt: "2026-04-01T00:00:50.000Z",
            endedAt: "2026-04-01T00:01:00.000Z",
            summary: "1 test passed",
          },
        },
      },
    ];
    currentExecutionUsage = {
      inputTokens: 1500,
      outputTokens: 700,
      totalTokens: 2200,
      costUsd: 0.0345,
      durationMs: 125000,
    };

    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByText("Spend")).toBeDefined();
    expect(screen.getByText(/2,200 tokens/)).toBeDefined();
    expect(screen.getByText(/\$0.0345/)).toBeDefined();
  });

  test("disables Mark Ready when task is unassigned", async () => {
    currentTasks = [
      buildTask({ assignedAgentId: null, assignedAgentName: null, assignedAgentWorkflow: null }),
    ];

    renderDetail();
    await settleTaskDetailEffects();

    expect((screen.getByTestId("mark-ready-button") as HTMLButtonElement).disabled).toBe(true);
  });

  test("keeps the primary action inline and destructive actions in an overflow menu", async () => {
    renderDetail();
    await settleTaskDetailEffects();

    expect(screen.getByTestId("mark-ready-button")).toBeDefined();
    expect(screen.queryByTestId("remove-task-button")).toBeNull();

    const menuTrigger = screen.getByTestId("task-actions-menu-button");
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(menuTrigger);
    expect(screen.getByTestId("remove-task-button")).toBeDefined();

    fireEvent.click(screen.getByTestId("remove-task-button"));

    expect(screen.getByText("Remove Task")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-confirm").textContent).toBe("Remove");
  });

  test("uses submit corrections as the primary draft action when review notes are pending", async () => {
    currentReviewNotes = [
      {
        id: "note-1",
        filePath: "issues.md",
        selectedText: "Use pg",
        note: "Use Bun.sql instead.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    renderDetail();
    await settleTaskDetailEffects();

    await waitFor(() =>
      expect(screen.getByTestId("mark-ready-button").textContent).toBe("Submit corrections"),
    );
    const primaryButton = screen.getByTestId("mark-ready-button");
    expect(primaryButton.getAttribute("data-action-state")).toBe("submit-corrections");
  });

  test("disables submit corrections when task is unassigned", async () => {
    currentTasks = [
      buildTask({ assignedAgentId: null, assignedAgentName: null, assignedAgentWorkflow: null }),
    ];
    currentReviewNotes = [
      {
        id: "note-1",
        filePath: "issues.md",
        selectedText: "Use pg",
        note: "Use Bun.sql instead.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    renderDetail();
    await settleTaskDetailEffects();

    await waitFor(() =>
      expect(screen.getByTestId("mark-ready-button").textContent).toBe("Submit corrections"),
    );
    const primaryButton = screen.getByTestId("mark-ready-button") as HTMLButtonElement;
    expect(primaryButton.disabled).toBe(true);
    expect(primaryButton.title).toBe("Assign a worker first");
  });

  test("keeps task metadata in a horizontal strip below the top bar", async () => {
    renderDetail();
    await settleTaskDetailEffects();

    const metaStrip = screen.getByTestId("task-meta-strip");

    expect(metaStrip.textContent).toContain("Repository");
    expect(metaStrip.textContent).toContain("aop-mono");
    expect(metaStrip.textContent).toContain("Workflow");
    expect(metaStrip.textContent).toContain("Created");
  });

  test("exposes reset, block, and remove for a working task in the overflow menu", async () => {
    currentTasks = [buildTask({ status: "WORKING", currentExecutionId: "exec-1" })];

    renderDetail();
    await settleTaskDetailEffects();

    const menuTrigger = screen.getByTestId("task-actions-menu-button");
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(menuTrigger);

    expect(screen.getByTestId("reset-task-button")).toBeDefined();
    expect(screen.getByTestId("block-task-button")).toBeDefined();
    expect(screen.getByTestId("remove-task-button")).toBeDefined();
  });

  test("keeps specs and logs tabs while improving execution history scanability", async () => {
    currentTasks = [buildTask({ status: "DONE", currentExecutionId: "exec-1" })];
    currentExecutions = [makeExecution()];

    renderDetail();
    await settleTaskDetailEffects();

    fireEvent.mouseDown(screen.getByTestId("tab-logs"), { button: 0, ctrlKey: false });

    await waitFor(() => expect(screen.getByTestId("execution-history")).toBeDefined());
    expect(screen.getByText("Execution history")).toBeDefined();
    expect(screen.getByText("1 run")).toBeDefined();
    expect(screen.getByText("1 step")).toBeDefined();
    expect(screen.getByText("Execution evidence")).toBeDefined();
    expect(screen.getByTestId("log-viewer")).toBeDefined();

    fireEvent.mouseDown(screen.getByTestId("tab-specs"), { button: 0, ctrlKey: false });

    await waitFor(() => expect(screen.getByTestId("specs-tab")).toBeDefined());
  });

  test("shows a useful missing-task state", async () => {
    renderDetail("missing-task");
    await settleTaskDetailEffects();

    expect(screen.getByText("Task not found")).toBeDefined();
    expect(
      screen.getByText("Return to the board or refresh after the next pool sync."),
    ).toBeDefined();
  });
});
