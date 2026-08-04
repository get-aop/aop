import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import {
  getAllDelegationCards,
  ingestDelegationSessionEvent,
  resetDelegationCenter,
} from "../../components/delegations/delegation-center";
import { setupDashboardDom } from "../../test/setup-dom";
import { TerminalDock } from "../../workspace/terminal-dock";
import { ChatComposer } from "./ChatComposer";
import { ChatThread } from "./ChatThread";
import { RenameSessionModal, SessionToast } from "./SessionModals";
import { SlashCommandMenu } from "./SlashCommandMenu";
import {
  resetSessionStreamProgressStore,
  setSessionStreamProgress,
} from "./session-stream-progress";
import { CHAT_COMMANDS, filterSlashCommands } from "./sessions-runtime";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");

class NullEventSource {
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

globalThis.EventSource = NullEventSource as unknown as typeof EventSource;

afterEach(() => {
  cleanup();
  resetDelegationCenter();
  resetSessionStreamProgressStore();
});

const activeDelegation = (sessionId: string, overrides: Record<string, unknown> = {}) => ({
  id: "del_thread",
  kind: "delegation" as const,
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
  reasoning: "high",
  fastMode: false,
  status: "active" as const,
  activity: null,
  runtimeSessionId: null,
  logFilePath: "/tmp/delegate.jsonl",
  error: null,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  hostRunId: "crun_1",
  hostRunStatus: "running",
  sessionId,
  sessionTitle: "Host session",
  ...overrides,
});

const seedActiveDelegation = (sessionId: string): void => {
  act(() => {
    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId,
      hostRunId: "crun_1",
      delegation: activeDelegation(sessionId),
    });
  });
};

describe("ChatComposer", () => {
  const baseProps = (): ComponentProps<typeof ChatComposer> => ({
    input: "",
    onInput: mock(() => {}),
    onSend: mock(() => {}),
    runtime: "claude-code",
    model: "claude-opus-4-8",
    effort: "medium",
    alias: null,
    connected: true,
    termOpen: false,
    onRuntimeMenu: mock(() => {}),
    onModelMenu: mock(() => {}),
    onEffortMenu: mock(() => {}),
    onMoreMenu: mock(() => {}),
    onSlashPick: mock(() => {}),
    termLines: [],
    termInput: "",
    onTermInput: mock(() => {}),
    onTermRun: mock(() => {}),
    onTermClose: mock(() => {}),
    repoPath: "/tmp/repo",
  });

  test("send disabled when empty; Enter sends; Shift+Enter does not", () => {
    const onSend = mock(() => {});
    const { rerender } = render(<ChatComposer {...baseProps()} onSend={onSend} />);
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      true,
    );

    rerender(<ChatComposer {...baseProps()} input="hello" onSend={onSend} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId("chat-composer-input");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});

describe("SlashCommandMenu", () => {
  test("opens on bare /prefix, filters, and inserts cmd with trailing space", () => {
    const onPick = mock(() => {});
    const { rerender } = render(
      <SlashCommandMenu
        input="/ta"
        caret={3}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onPick={onPick}
      />,
    );
    const menu = screen.getByTestId("slash-command-menu");
    expect(menu.className).toContain("rounded-[20px]");
    expect(menu.className).toContain("bg-popover/96");
    expect(menu.className).toContain("backdrop-blur-xs");
    expect(within(menu).getByText("/task create")).toBeTruthy();
    expect(within(menu).queryByText("/status")).toBeNull();
    fireEvent.click(within(menu).getByText("/task create"));
    expect(onPick).toHaveBeenCalledWith("/task create ");

    rerender(
      <SlashCommandMenu
        input="hello /ta"
        caret={9}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onPick={onPick}
      />,
    );
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    expect(within(screen.getByTestId("slash-command-menu")).getByText("/task create")).toBeTruthy();
  });
});

describe("SessionModals", () => {
  test("rename focuses input and supports Enter / Escape", () => {
    const onSave = mock(() => {});
    const onCancel = mock(() => {});
    render(
      <RenameSessionModal
        open
        value="Draft"
        onChange={() => {}}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByPlaceholderText("Session name") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  test("toast renders message", () => {
    render(<SessionToast toast={{ message: "Settled · Demo" }} />);
    expect(screen.getByTestId("session-toast").textContent).toContain("Settled · Demo");
  });

  test("toast renders an optional link", () => {
    render(
      <SessionToast
        toast={{
          message: "PR #42 created",
          link: { url: "https://github.com/o/r/pull/42", label: "#42" },
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "#42" });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
  });
});

describe("ChatThread segments + TerminalDock", () => {
  test("delegations stay out of the thread and live in the Tasks pane (PLAN §7.2)", () => {
    seedActiveDelegation("isess_delegating");
    render(
      <ChatThread
        sessionId="isess_delegating"
        repoName="aop-mono"
        runtime="claude-code"
        model="claude-opus-4-8"
        effort="medium"
        alias={null}
        messages={[]}
        typing={true}
        workerNames={[]}
        workerColors={{}}
        onAction={() => {}}
      />,
    );

    // No floating specialist card inside the thread.
    expect(screen.queryByTestId("specialist-checking")).toBeNull();
    expect(screen.queryByText(/Specialist checking/)).toBeNull();
    // The run is tracked by the delegation center (Tasks pane data source).
    expect(getAllDelegationCards()).toHaveLength(1);
    // The raw specialist stream never renders under the host thread.
    expect(screen.queryByTestId("assistant-thinking")).toBeNull();
    expect(screen.queryByTestId("assistant-stream-content")).toBeNull();
  });

  test("the host live-activity surface keeps rendering while a delegation runs", () => {
    seedActiveDelegation("isess_delegating");
    render(
      <ChatThread
        sessionId="isess_delegating"
        repoName="aop-mono"
        runtime="claude-code"
        model="claude-opus-4-8"
        effort="medium"
        alias={null}
        messages={[]}
        typing={true}
        workerNames={[]}
        workerColors={{}}
        onAction={() => {}}
      />,
    );

    // Host turn continues with its normal live activity surface.
    act(() => {
      setSessionStreamProgress("isess_delegating", {
        thinking: "",
        content: "",
        commandGroups: [],
      });
    });
    expect(screen.getByText("Working...")).toBeTruthy();
    expect(screen.queryByTestId("specialist-checking")).toBeNull();
  });

  test("terminal dock runs on Enter and closes", () => {
    const onTermRun = mock(() => {});
    const onTermClose = mock(() => {});
    render(
      <TerminalDock
        ecmd="claude"
        repoPath="/tmp/repo"
        branch={null}
        termLines={[{ text: "$ ls", tone: "cmd" }]}
        termInput="ls"
        onTermInput={() => {}}
        onTermRun={onTermRun}
        onTermClose={onTermClose}
      />,
    );
    fireEvent.keyDown(screen.getByDisplayValue("ls"), { key: "Enter" });
    expect(onTermRun).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onTermClose).toHaveBeenCalled();
  });
});

describe("slash filter helper (segments / auto-title seam)", () => {
  test("filterSlashCommands matches concept list", () => {
    expect(filterSlashCommands("/")).toHaveLength(CHAT_COMMANDS.length);
    expect(filterSlashCommands("/st").map((c) => c.cmd)).toEqual(["/status"]);
  });
});
