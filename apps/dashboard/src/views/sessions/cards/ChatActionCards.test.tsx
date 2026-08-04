import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatActionPayload } from "@aop/common";
import { setupDashboardDom } from "../../../test/setup-dom";

setupDashboardDom();

const mockConfirmTaskAssignment = mock(async (_proposal: unknown, _mode: "assign" | "start") => ({
  ok: true,
  taskIds: ["task-1"],
}));
const mockConfirmTaskBatchRow = mock(async (_input: unknown, _source?: unknown) => ({
  ok: true,
  taskId: "task-a",
}));
const mockApproveHandoff = mock(async () => ({ taskId: "t1" }));
const mockRejectHandoff = mock(async () => ({ taskId: "t1" }));
const mockCreateAgent = mock(async () => ({ id: "a1" }));
const mockSaveWorkflow = mock(async () => ({ id: "wf1", name: "x" }));

mock.module("../../../api/client", () => ({
  confirmTaskAssignment: mockConfirmTaskAssignment,
  confirmTaskBatchRow: mockConfirmTaskBatchRow,
  approveHandoff: mockApproveHandoff,
  rejectHandoff: mockRejectHandoff,
  createAgent: mockCreateAgent,
  saveWorkflow: mockSaveWorkflow,
}));

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ChatActionCards } = await import("./ChatActionCards");

beforeEach(() => {
  mockConfirmTaskAssignment.mockReset();
  mockConfirmTaskAssignment.mockResolvedValue({ ok: true, taskIds: ["task-1"] });
  mockConfirmTaskBatchRow.mockReset();
  mockConfirmTaskBatchRow.mockResolvedValue({ ok: true, taskId: "task-a" });
  mockApproveHandoff.mockReset();
  mockRejectHandoff.mockReset();
  mockCreateAgent.mockReset();
  mockSaveWorkflow.mockReset();
});

afterEach(cleanup);

const taskAssignmentAction: ChatActionPayload = {
  type: "task-assignment",
  id: "task-1",
  label: "Task created",
  sub: "Ship it",
  meta: "Backlog",
  status: "live",
  proposal: {
    taskIds: ["task-1"],
    title: "Ship it",
    repoId: "repo-1",
    workerId: "w1",
  },
};

const batchWorkers = [
  { id: "w1", name: "K1" },
  { id: "w2", name: "K2" },
];

const taskBatchAction = (): ChatActionPayload => ({
  type: "task-batch-assignment",
  label: "3 tasks created",
  sub: "Dark mode +2 more",
  meta: "Backlog",
  status: "live",
  proposal: {
    repoId: "repo-1",
    items: [
      { taskId: "task-a", title: "Dark mode", workerId: "w1" },
      { taskId: "task-b", title: "CSV export" },
      { taskId: "task-c", title: "Keyboard nav" },
    ],
  },
});

describe("ChatActionCards confirm paths", () => {
  test("shows the task link, prefills the worker, and supports assign", async () => {
    const onNavigate = mock(() => {});
    render(
      <ChatActionCards
        action={taskAssignmentAction}
        onNavigate={onNavigate}
        onLegacyAction={mock(() => {})}
        workers={[
          { id: "w1", name: "K1" },
          { id: "w2", name: "K2" },
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Worker" }).textContent).toContain("K1");
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(onNavigate).toHaveBeenCalledWith("/tasks/task-1");

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(mockConfirmTaskAssignment).toHaveBeenCalled());
    expect(mockConfirmTaskAssignment.mock.calls[0]?.[1]).toBe("assign");
  });

  test("restores confirmed assignment state from the persisted action", () => {
    render(
      <ChatActionCards
        sessionId="session-1"
        messageId="message-1"
        action={{ ...taskAssignmentAction, status: "confirmed" }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={[{ id: "w1", name: "K1" }]}
      />,
    );

    expect(screen.getByText("Assigned")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Worker" }).textContent).toContain("K1");
  });

  test("restores legacy assignment state from assigned tasks", () => {
    render(
      <ChatActionCards
        action={{ ...taskAssignmentAction, status: "proposed" }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        tasks={[{ id: "task-1", status: "DRAFT", assignedAgentId: "w1" }]}
        workers={[{ id: "w1", name: "K1" }]}
      />,
    );

    expect(screen.getByText("Assigned")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Worker" }).textContent).toContain("K1");
  });

  test("requires a worker and supports assign and start", async () => {
    render(
      <ChatActionCards
        action={{
          ...taskAssignmentAction,
          proposal: {
            taskIds: ["task-1"],
            title: "Ship it",
            repoId: "repo-1",
            workerId: null,
          },
        }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={[{ id: "w2", name: "K2" }]}
      />,
    );

    expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const workerTrigger = screen.getByRole("combobox", { name: "Worker" });
    fireEvent.pointerDown(workerTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(workerTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "K2" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign and Start" }));

    await waitFor(() => expect(mockConfirmTaskAssignment).toHaveBeenCalled());
    expect(mockConfirmTaskAssignment.mock.calls[0]?.[1]).toBe("start");
  });

  test("stale assignment shows error state from API rejection", async () => {
    mockConfirmTaskAssignment.mockRejectedValueOnce({
      code: "STALE_TASK",
      message: "Task is already assigned: task-1",
    });
    render(
      <ChatActionCards
        action={taskAssignmentAction}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("STALE_TASK"));
    expect(screen.getByRole("alert").textContent).toContain("Task is already assigned");
  });

  test("shows a next arrow only after assigning each task in a batch", async () => {
    render(
      <ChatActionCards
        action={{
          ...taskAssignmentAction,
          id: undefined,
          proposal: {
            taskIds: ["task-1", "task-2"],
            repoId: "repo-1",
            workerId: "w1",
          },
        }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={[{ id: "w1", name: "K1" }]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Next task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next task" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next task" }));
    expect(screen.getByText("Task 2 of 2")).toBeTruthy();
  });

  test("multi-select candidates require worker and at least one task", async () => {
    render(
      <ChatActionCards
        action={{
          type: "task-assignment",
          label: "Assign tasks",
          sub: "Backlog",
          meta: "Choose a worker",
          status: "proposed",
          proposal: {
            taskIds: [],
            repoId: "repo-1",
            workerId: null,
            candidates: [
              { id: "task-a", title: "docs/tasks/alpha" },
              { id: "task-b", title: "docs/tasks/beta" },
            ],
          },
        }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={[
          { id: "w1", name: "K1" },
          { id: "w2", name: "K2" },
        ]}
      />,
    );

    expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/tasks/alpha" }));
    const workerTrigger = screen.getByRole("combobox", { name: "Worker" });
    fireEvent.pointerDown(workerTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(workerTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "K1" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign and Start" }));

    await waitFor(() => expect(mockConfirmTaskAssignment).toHaveBeenCalled());
    expect(mockConfirmTaskAssignment.mock.calls[0]?.[0]).toMatchObject({
      taskIds: ["task-a"],
      workerId: "w1",
      repoId: "repo-1",
    });
    expect(mockConfirmTaskAssignment.mock.calls[0]?.[1]).toBe("start");
  });

  test("batch card renders one row per item with worker prefills and routed progress", () => {
    const onNavigate = mock(() => {});
    render(
      <ChatActionCards
        action={taskBatchAction()}
        onNavigate={onNavigate}
        onLegacyAction={mock(() => {})}
        workers={batchWorkers}
      />,
    );

    const card = screen.getByTestId("task-batch-assignment-card");
    expect(card.textContent).toContain("3 tasks created");
    expect(card.textContent).toContain("0 of 3 routed");
    const rows = screen.getAllByTestId("task-batch-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Dark mode");
    expect(rows[1]?.textContent).toContain("CSV export");
    expect(rows[2]?.textContent).toContain("Keyboard nav");

    // Prefilled worker on row 1; Backlog default elsewhere.
    expect(
      within(rows[0] as HTMLElement).getByRole("combobox", { name: "Destination for Dark mode" })
        .textContent,
    ).toContain("K1");
    expect(
      within(rows[1] as HTMLElement).getByRole("combobox", { name: "Destination for CSV export" })
        .textContent,
    ).toContain("Backlog");

    // Worker rows offer both actions; Backlog rows only Assign.
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Assign and Start" }),
    ).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).queryByRole("button", { name: "Assign and Start" }),
    ).toBeNull();
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Assign" })).toBeTruthy();

    fireEvent.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Open" }));
    expect(onNavigate).toHaveBeenCalledWith("/tasks/task-c");
  });

  test("batch row Assign and Start posts exactly one taskId with started outcome", async () => {
    render(
      <ChatActionCards
        sessionId="session-1"
        messageId="message-1"
        action={taskBatchAction()}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={batchWorkers}
      />,
    );

    const rows = screen.getAllByTestId("task-batch-row");
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Assign and Start" }),
    );

    await waitFor(() => expect(mockConfirmTaskBatchRow).toHaveBeenCalledTimes(1));
    expect(mockConfirmTaskBatchRow.mock.calls[0]?.[0]).toMatchObject({
      taskId: "task-a",
      repoId: "repo-1",
      workerId: "w1",
      outcome: "started",
    });
    expect(mockConfirmTaskBatchRow.mock.calls[0]?.[1]).toEqual({
      sessionId: "session-1",
      messageId: "message-1",
    });
    await waitFor(() =>
      expect(within(rows[0] as HTMLElement).getByText("Started · K1")).toBeTruthy(),
    );
    expect(screen.getByTestId("task-batch-assignment-card").textContent).toContain("1 of 3 routed");
  });

  test("batch Backlog rows persist via confirm with backlog outcome", async () => {
    render(
      <ChatActionCards
        sessionId="session-1"
        messageId="message-1"
        action={taskBatchAction()}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={batchWorkers}
      />,
    );

    const rows = screen.getAllByTestId("task-batch-row");
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(within(rows[1] as HTMLElement).getByText("In Backlog")).toBeTruthy(),
    );
    expect(mockConfirmTaskBatchRow).toHaveBeenCalledTimes(1);
    expect(mockConfirmTaskBatchRow.mock.calls[0]?.[0]).toMatchObject({
      taskId: "task-b",
      outcome: "backlog",
      workerId: null,
    });
    expect(screen.getByTestId("task-batch-assignment-card").textContent).toContain("1 of 3 routed");
  });

  test("batch row failure shows a row alert and leaves other rows actionable", async () => {
    mockConfirmTaskBatchRow.mockRejectedValueOnce({
      code: "STALE_TASK",
      message: "Task is already assigned: task-a",
    });
    render(
      <ChatActionCards
        action={taskBatchAction()}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={batchWorkers}
      />,
    );

    const rows = screen.getAllByTestId("task-batch-row");
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Assign and Start" }),
    );
    await waitFor(() =>
      expect(within(rows[0] as HTMLElement).getByRole("alert").textContent).toContain("STALE_TASK"),
    );
    // The failed row keeps its controls; other rows are untouched.
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Assign and Start" }),
    ).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("alert")).toBeNull();

    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(within(rows[1] as HTMLElement).getByText("In Backlog")).toBeTruthy(),
    );
    expect(mockConfirmTaskBatchRow).toHaveBeenCalledTimes(2);
  });

  test("batch footer summarizes routing once every row resolves", async () => {
    render(
      <ChatActionCards
        action={taskBatchAction()}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        workers={batchWorkers}
      />,
    );

    const rows = screen.getAllByTestId("task-batch-row");
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(within(rows[0] as HTMLElement).getByText("Assigned · K1")).toBeTruthy(),
    );
    expect(screen.queryByTestId("task-batch-footer")).toBeNull();

    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Assign" }));
    fireEvent.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(screen.getByTestId("task-batch-footer")).toBeTruthy());
    expect(screen.getByTestId("task-batch-footer").textContent).toBe(
      "1 assigned · 0 started · 2 in Backlog",
    );
    expect(screen.getByTestId("task-batch-assignment-card").textContent).toContain("3 of 3 routed");
  });

  test("batch card restores routed rows from persisted action and live tasks", () => {
    render(
      <ChatActionCards
        sessionId="session-1"
        messageId="message-1"
        action={{
          ...taskBatchAction(),
          proposal: {
            repoId: "repo-1",
            items: [
              {
                taskId: "task-a",
                title: "Dark mode",
                workerId: "w1",
                routedOutcome: "started",
                routedWorkerId: "w1",
              },
              { taskId: "task-b", title: "CSV export", routedOutcome: "backlog" },
              { taskId: "task-c", title: "Keyboard nav" },
            ],
          },
        }}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        tasks={[{ id: "task-c", status: "DRAFT", assignedAgentId: "w2" }]}
        workers={batchWorkers}
      />,
    );

    const rows = screen.getAllByTestId("task-batch-row");
    expect(within(rows[0] as HTMLElement).getByText("Started · K1")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("In Backlog")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Assigned · K2")).toBeTruthy();
    expect(screen.getByTestId("task-batch-assignment-card").textContent).toContain("3 of 3 routed");
    expect(screen.getByTestId("task-batch-footer").textContent).toBe(
      "1 assigned · 1 started · 1 in Backlog",
    );
  });

  test("task-live card uses live status from tasks feed", () => {
    const action: ChatActionPayload = {
      type: "task-live",
      id: "task-9",
      label: "Live task",
      sub: "working",
      meta: "DRAFT",
    };
    render(
      <ChatActionCards
        action={action}
        onNavigate={mock(() => {})}
        onLegacyAction={mock(() => {})}
        tasks={[{ id: "task-9", status: "PAUSED" }]}
      />,
    );
    expect(screen.getByTestId("task-live-card").textContent).toContain("PAUSED");
  });

  test("workflow preview without full definition hands off to Studio only", () => {
    const onNavigate = mock(() => {});
    render(
      <ChatActionCards
        action={{
          type: "workflow-preview",
          label: "Draft",
          sub: "wf",
          meta: "preview",
          status: "proposed",
          proposal: {
            name: "combo",
            steps: [{ id: "s1", type: "implement", model: "gpt" }],
          },
        }}
        onNavigate={onNavigate}
        onLegacyAction={mock(() => {})}
      />,
    );

    expect(screen.getByTestId("workflow-preview-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in Studio" }));
    expect(onNavigate).toHaveBeenCalledWith("/workflows");
    expect(mockSaveWorkflow).not.toHaveBeenCalled();
  });

  test("unknown legacy actions fall back to plain clickable card", () => {
    const onLegacy = mock(() => {});
    render(
      <ChatActionCards
        action={{ type: "pool", label: "Backlog", sub: "x", meta: "y" }}
        onNavigate={mock(() => {})}
        onLegacyAction={onLegacy}
      />,
    );
    fireEvent.click(screen.getByText("Backlog"));
    expect(onLegacy).toHaveBeenCalled();
  });
});
