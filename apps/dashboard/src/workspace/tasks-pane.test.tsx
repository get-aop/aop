import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatDelegationRunDto } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const getChatDelegationOutput = mock(async (_sessionId: string, _delegationId: string) => ({
  delegation: delegation(),
  output: { thinking: "", content: "final specialist answer", commandGroups: [] },
}));

const actualClient = await import("../api/client");
mock.module("../../api/client", () => ({
  ...actualClient,
  getChatDelegationOutput,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { TasksPane } = await import("./tasks-pane");
const { ingestDelegationSessionEvent, resetDelegationCenter, setDelegationSessionFocus } =
  await import("../components/delegations/delegation-center");

const delegation = (overrides: Partial<ChatDelegationRunDto> = {}): ChatDelegationRunDto => ({
  id: "del_1",
  kind: "delegation",
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
  reasoning: "high",
  fastMode: false,
  status: "active",
  activity: "Running bun test",
  runtimeSessionId: "specialist-thread-9",
  logFilePath: "/tmp/delegate.jsonl",
  error: null,
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  updatedAt: new Date().toISOString(),
  hostRunId: "crun_1",
  hostRunStatus: "running",
  sessionId: "isess_1",
  sessionTitle: "Host session",
  ...overrides,
});

class NullEventSource {
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  getChatDelegationOutput.mockClear();
  globalThis.EventSource = NullEventSource as unknown as typeof EventSource;
  resetDelegationCenter();
});

afterEach(() => {
  cleanup();
  resetDelegationCenter();
});

describe("TasksPane", () => {
  test("row click opens the non-modal detail overlay, not a blocking dialog", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    setDelegationSessionFocus("isess_1");

    render(<TasksPane />);

    fireEvent.click(await screen.findByTestId("tasks-row"));
    // The detail overlay is a non-modal panel (aria-modal=false): the app
    // behind it stays interactive instead of a scrim blocking everything.
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(screen.getByText("Waiting for specialist output…")).toBeTruthy();
  });

  test("closing the detail keeps the task card in the list", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    setDelegationSessionFocus("isess_1");

    render(<TasksPane />);

    fireEvent.click(await screen.findByTestId("tasks-row"));
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Closing the detail must not dismiss the card from the list.
    expect(screen.getAllByTestId("tasks-row")).toHaveLength(1);
  });
});
