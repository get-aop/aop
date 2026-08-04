import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatDelegationRunDto } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const abortChatSession = mock(async (_sessionId: string) => ({ aborted: true }));
const getChatDelegationOutput = mock(async (_sessionId: string, _delegationId: string) => ({
  delegation: delegation(),
  output: { thinking: "", content: "final specialist answer", commandGroups: [] },
}));

const actualClient = await import("../../api/client");
mock.module("../../api/client", () => ({
  ...actualClient,
  abortChatSession,
  getChatDelegationOutput,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { DelegationDetailView } = await import("./DelegationDetailView");
const { ingestDelegationSessionEvent, resetDelegationCenter } = await import("./delegation-center");

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
  abortChatSession.mockClear();
  getChatDelegationOutput.mockClear();
  globalThis.EventSource = NullEventSource as unknown as typeof EventSource;
  resetDelegationCenter();
});

afterEach(() => {
  cleanup();
  resetDelegationCenter();
});

describe("DelegationDetailView", () => {
  test("shows runtime, model, status, elapsed, and live specialist output", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    ingestDelegationSessionEvent({
      type: "delegation-progress",
      sessionId: "isess_1",
      delegationId: "del_1",
      thinking: "",
      content: "streaming specialist work",
      commandGroups: [
        { id: "g1", commands: [{ id: "c1", command: "bun test", status: "running" }] },
      ],
    });

    render(<DelegationDetailView delegationId="del_1" onClose={() => {}} />);

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText(/Codex CLI/)).toBeTruthy();
    expect(screen.getByText(/GPT 5\.5/)).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByText(/streaming specialist work/)).toBeTruthy();
    expect(screen.getByText(/Running 1 action/)).toBeTruthy();
    expect(screen.getByText(/specialist-thread-9/)).toBeTruthy();
  });

  test("cancel is explicit and calls the session abort endpoint", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    render(<DelegationDetailView delegationId="del_1" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel delegated run/i }));
    expect(abortChatSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm cancel/i }));

    await waitFor(() => expect(abortChatSession).toHaveBeenCalledWith("isess_1"));
  });

  test("background tasks do not offer cancel-as-if-specialist", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({
        kind: "background-task",
        label: "Inspect cards",
        runtimeSessionId: null,
      }),
    });
    render(<DelegationDetailView delegationId="del_1" onClose={() => {}} />);

    expect(screen.queryByRole("button", { name: /cancel delegated run/i })).toBeNull();
    expect(screen.getByText(/Ends with the host turn/i)).toBeTruthy();
    expect(abortChatSession).not.toHaveBeenCalled();
  });

  test("no cancel action for terminal runs; failed runs show the error", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({ status: "failed", error: "provider exploded" }),
    });
    render(<DelegationDetailView delegationId="del_1" onClose={() => {}} />);

    expect(screen.queryByRole("button", { name: /cancel delegated run/i })).toBeNull();
    expect(screen.getByText(/provider exploded/)).toBeTruthy();
  });

  test("terminal runs load persisted output when no live buffer exists", async () => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({ status: "completed" }),
    });
    render(<DelegationDetailView delegationId="del_1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/final specialist answer/)).toBeTruthy());
    expect(getChatDelegationOutput).toHaveBeenCalledWith("isess_1", "del_1");
  });

  test("escape returns to the host conversation", async () => {
    const onClose = mock(() => {});
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    render(<DelegationDetailView delegationId="del_1" onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog", { name: /% delegation: Codex/i }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
