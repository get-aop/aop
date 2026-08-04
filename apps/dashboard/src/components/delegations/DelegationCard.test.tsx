import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatDelegationRunDto } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { DelegationCardState } from "./delegation-center";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DelegationCard } = await import("./DelegationCard");
const { formatDelegationElapsed } = await import("./delegation-format");

const NOW = Date.parse("2026-07-16T10:00:42.000Z");

const stateFor = (overrides: Partial<ChatDelegationRunDto> = {}): DelegationCardState => ({
  delegation: {
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
    runtimeSessionId: null,
    logFilePath: "/tmp/delegate.jsonl",
    error: null,
    startedAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:40.000Z",
    hostRunId: "crun_1",
    hostRunStatus: "running",
    sessionId: "isess_1",
    sessionTitle: "Host session",
    ...overrides,
  },
  live: null,
  dismissed: false,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
});

describe("DelegationCard", () => {
  test("shows runtime, model, delegation type, status, activity, and elapsed time", () => {
    render(<DelegationCard state={stateFor()} now={NOW} onOpen={() => {}} onDismiss={() => {}} />);

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText(/Codex CLI/)).toBeTruthy();
    expect(screen.getByText(/GPT 5\.5/)).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Running bun test")).toBeTruthy();
    expect(screen.getByText("0:42")).toBeTruthy();
  });

  test("does not label an active runtime as Thinking", () => {
    render(<DelegationCard state={stateFor()} now={NOW} onOpen={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByText("Thinking")).toBeNull();
  });

  test("renders each status distinctly", () => {
    const cases: Array<[ChatDelegationRunDto["status"], string]> = [
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(
        <DelegationCard
          state={stateFor({ status })}
          now={NOW}
          onOpen={() => {}}
          onDismiss={() => {}}
        />,
      );
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  test("shows quick-action intent and runtime name", () => {
    render(
      <DelegationCard
        state={stateFor({
          kind: "quick-action",
          label: "Review",
          runtime: "pi",
          model: "kimi-coding/k3",
        })}
        now={NOW}
        onOpen={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText(/PI · Kimi K3 Max/)).toBeTruthy();
  });

  test("clicking the card opens the specialist session", () => {
    const onOpen = mock(() => {});
    render(<DelegationCard state={stateFor()} now={NOW} onOpen={onOpen} onDismiss={() => {}} />);
    fireEvent.click(screen.getByTestId("delegation-card-del_1"));
    expect(onOpen).toHaveBeenCalledWith("del_1");
  });

  test("X dismisses the card without cancelling anything", () => {
    const onDismiss = mock(() => {});
    const onOpen = mock(() => {});
    render(<DelegationCard state={stateFor()} now={NOW} onOpen={onOpen} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("del_1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("exposes an aria-live status announcement", () => {
    render(<DelegationCard state={stateFor()} now={NOW} onOpen={() => {}} onDismiss={() => {}} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Working");
  });
});

describe("formatDelegationElapsed", () => {
  test("formats running and long durations", () => {
    expect(
      formatDelegationElapsed("2026-07-16T10:00:00.000Z", Date.parse("2026-07-16T10:00:42.000Z")),
    ).toBe("0:42");
    expect(
      formatDelegationElapsed("2026-07-16T10:00:00.000Z", Date.parse("2026-07-16T10:07:05.000Z")),
    ).toBe("7:05");
    expect(
      formatDelegationElapsed("2026-07-16T09:00:00.000Z", Date.parse("2026-07-16T10:02:03.000Z")),
    ).toBe("1:02:03");
  });
});
