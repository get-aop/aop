import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

// Radix reads `document` when its module evaluates, so components load after the DOM exists.
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ChatComposer } = await import("./ChatComposer");
const { ChatThread } = await import("./ChatThread");
const { RenameSessionModal, SessionToast } = await import("./SessionModals");
const { SlashCommandMenu } = await import("./SlashCommandMenu");
const { resetSessionStreamProgressStore, setSessionStreamProgress } = await import(
  "./session-stream-progress"
);
const { CHAT_COMMANDS, filterSlashCommands } = await import("./sessions-runtime");

class NullEventSource {
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

globalThis.EventSource = NullEventSource as unknown as typeof EventSource;

afterEach(() => {
  cleanup();
  resetSessionStreamProgressStore();
});

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
    onRuntimeMenu: mock(() => {}),
    onModelMenu: mock(() => {}),
    onEffortMenu: mock(() => {}),
    onMoreMenu: mock(() => {}),
    onSlashPick: mock(() => {}),
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
        input="/sk"
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
    expect(within(menu).getByText("/skill")).toBeTruthy();
    expect(within(menu).queryByText("/status")).toBeNull();
    fireEvent.click(within(menu).getByText("/skill"));
    expect(onPick).toHaveBeenCalledWith("/skill ");

    rerender(
      <SlashCommandMenu
        input="hello /sk"
        caret={9}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onPick={onPick}
      />,
    );
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    expect(within(screen.getByTestId("slash-command-menu")).getByText("/skill")).toBeTruthy();
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

describe("ChatThread live activity", () => {
  test("shows the working row while the assistant types, before any stream content arrives", () => {
    render(
      <ChatThread
        sessionId="isess_live"
        repoName="aop-mono"
        runtime="claude-code"
        model="claude-opus-4-8"
        effort="medium"
        alias={null}
        messages={[]}
        typing={true}
      />,
    );

    expect(screen.queryByTestId("assistant-thinking")).toBeNull();
    expect(screen.queryByTestId("assistant-stream-content")).toBeNull();

    act(() => {
      setSessionStreamProgress("isess_live", { thinking: "", content: "", commandGroups: [] });
    });
    expect(screen.getByText("Working...")).toBeTruthy();
  });
});

describe("slash filter helper (segments / auto-title seam)", () => {
  test("filterSlashCommands matches concept list", () => {
    expect(filterSlashCommands("/")).toHaveLength(CHAT_COMMANDS.length);
    expect(filterSlashCommands("/sk").map((c) => c.cmd)).toEqual(["/skill"]);
  });
});
