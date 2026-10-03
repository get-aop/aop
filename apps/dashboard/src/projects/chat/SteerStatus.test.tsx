import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { Message, TurnPart } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { ChatApi } from "./chat-api";
import type { LiveTurn } from "./chat-state";
import { page, userMessage } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ChatApiProvider } = await import("./chat-api");
const { MessageList } = await import("./MessageList");

afterEach(() => {
  cleanup();
  setSystemTime();
});

const NOW = new Date("2026-10-03T10:03:12.000Z");

const bash = (detail: string, startedAt?: string): TurnPart => ({
  type: "tool",
  id: `t_${detail}`,
  name: "Bash",
  detail,
  status: "running",
  ...(startedAt && { startedAt }),
});

const live = (parts: TurnPart[]): Record<string, LiveTurn> => ({ a1: { parts, inReplyTo: "u1" } });

/** The list over a host whose interrupt answers as `interrupt` says; `calls` are what it was asked. */
const renderList = (
  messages: readonly Message[],
  turns: Record<string, LiveTurn>,
  interrupt: () => Promise<"interrupted" | "delivered"> = async () => "interrupted",
) => {
  const calls: Array<[string, string]> = [];
  const api: ChatApi = {
    listMessages: async () => page([]),
    sendMessage: async () => {
      throw new Error("not used");
    },
    startSuggestion: async () => {
      throw new Error("not used");
    },
    skipSuggestion: async () => {},
    unskipSuggestion: async () => {},
    interruptForMessage: (projectId, messageId) => {
      calls.push([projectId, messageId]);
      return interrupt();
    },
  };
  render(
    <ChatApiProvider value={api}>
      <MessageList live={turns} working firstNewId={null} scrollToEndKey={0} messages={messages} />
    </ChatApiProvider>,
  );
  return calls;
};

const steerIn = (text = "stop, use arm64") => [
  userMessage("u1", 1),
  userMessage("u2", 2, { text, steers: "a1" }),
];

describe("a message waiting in the turn being written", () => {
  test("names the step it waits on and how long that step has run", () => {
    setSystemTime(NOW);
    renderList(steerIn(), live([bash("bun test", "2026-10-03T10:00:00.000Z")]));

    const caption = screen.getByTestId("steered-message-caption");
    expect(caption.getAttribute("data-waiting-on")).toBe("step");
    expect(screen.getByTestId("steer-waiting").textContent).toBe(
      "Waiting for the current step to finish: Bash `bun test` · running 3m 12s",
    );
    expect(within(caption).getByTestId("steer-interrupt").textContent).toBe("Interrupt now");
  });

  test("waits on what the agent writes while no step runs", () => {
    renderList(steerIn(), live([{ type: "text", text: "Looking at the logs" }]));

    expect(screen.getByTestId("steered-message-caption").getAttribute("data-waiting-on")).toBe(
      "writing",
    );
    expect(screen.getByTestId("steer-waiting").textContent).toBe(
      "Waiting for it to finish what it is writing",
    );
  });

  test("Interrupt now asks the host for this message, then says it reads it next", async () => {
    const calls = renderList(steerIn(), live([bash("sleep 120")]));

    await act(async () => {
      fireEvent.click(screen.getByTestId("steer-interrupt"));
    });

    expect(calls).toEqual([["prj_1", "u2"]]);
    expect(screen.queryByTestId("steer-interrupt")).toBeNull();
    expect(screen.getByTestId("steer-interrupted").textContent).toContain(
      "Interrupted, it reads this next",
    );
  });

  test("an interrupt the host refuses says why and can be tried again", async () => {
    renderList(steerIn(), live([bash("sleep 120")]), async () => {
      throw new Error("The message is not waiting on a running turn");
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("steer-interrupt"));
    });

    expect(screen.getByTestId("steer-interrupt-error").textContent).toBe(
      "Could not interrupt: The message is not waiting on a running turn",
    );
    expect(screen.getByTestId("steer-interrupt").hasAttribute("disabled")).toBe(false);
  });
});

describe("a message held for after the turn being written", () => {
  const held = [userMessage("u1", 1), userMessage("u2", 2, { text: "then the changelog" })];

  test("says it is queued for after this turn, with Interrupt now", async () => {
    const calls = renderList(held, live([bash("bun test")]));

    const row = screen
      .getAllByTestId("user-message")
      .find((item) => item.getAttribute("data-message-id") === "u2") as HTMLElement;
    const caption = within(row).getByTestId("queued-message-caption");
    expect(caption.textContent).toContain("Queued for after this turn");
    await act(async () => {
      fireEvent.click(within(caption).getByTestId("steer-interrupt"));
    });
    expect(calls).toEqual([["prj_1", "u2"]]);
  });

  test("the message the turn answers is not queued", () => {
    renderList(held, live([bash("bun test")]));

    const first = screen
      .getAllByTestId("user-message")
      .find((item) => item.getAttribute("data-message-id") === "u1") as HTMLElement;
    expect(within(first).queryByTestId("queued-message-caption")).toBeNull();
  });
});
