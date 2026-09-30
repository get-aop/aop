import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Message } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { EarlierMessages } from "./chat-state";
import { reply, userMessage } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { COORDINATOR_WORKER, MessageList } = await import("./MessageList");

afterEach(cleanup);

const THREAD_WORKER = { name: "Claude Code", testIdPrefix: "thread" };

const renderList = (
  props: Partial<Parameters<typeof MessageList>[0]> & { messages: readonly Message[] },
) =>
  render(<MessageList live={{}} working={false} firstNewId={null} scrollToEndKey={0} {...props} />);

const assistantOf = (id: string) =>
  screen
    .getAllByTestId("assistant-message")
    .find((row) => row.getAttribute("data-message-id") === id) as HTMLElement;

describe("who is working", () => {
  test("is the coordinator unless a worker is named, with the ids the chat has always had", async () => {
    renderList({
      messages: [userMessage("u1", 1)],
      working: true,
      live: { a1: "Reading the threads" },
    });

    expect(screen.getByTestId("coordinator-activity")).toBeTruthy();
    expect(screen.getByTestId("coordinator-working").textContent).toContain(
      "Coordinator is working",
    );
    await waitFor(() =>
      expect(screen.getByTestId("coordinator-live-text").textContent).toContain("Reading"),
    );
    expect(screen.queryByTestId("thread-working")).toBeNull();
    expect(COORDINATOR_WORKER).toEqual({ name: "Coordinator", testIdPrefix: "coordinator" });
  });

  test("a named worker renames the line and its ids: the thread's agent is not the coordinator", async () => {
    renderList({
      messages: [userMessage("u1", 1, { threadId: "thr_1" })],
      working: true,
      live: { a1: "Reading the tests" },
      worker: THREAD_WORKER,
    });

    expect(screen.getByTestId("thread-activity")).toBeTruthy();
    expect(screen.getByTestId("thread-working").textContent).toContain("Claude Code is working");
    await waitFor(() =>
      expect(screen.getByTestId("thread-live-text").textContent).toContain("Reading the tests"),
    );
    expect(screen.queryByTestId("coordinator-activity")).toBeNull();
    expect(screen.queryByTestId("coordinator-working")).toBeNull();
    expect(screen.queryByTestId("coordinator-live-text")).toBeNull();
  });

  test("nothing is shown as working while nothing works", () => {
    renderList({ messages: [userMessage("u1", 1), reply("a1", 2)], worker: THREAD_WORKER });

    expect(screen.queryByTestId("thread-activity")).toBeNull();
  });
});

describe("a reply whose run failed", () => {
  test("is drawn as an error with the runtime's words under a heading, and a good reply is not", () => {
    renderList({
      messages: [
        userMessage("u1", 1),
        reply("good", 2),
        userMessage("u2", 3),
        reply("bad", 4, [{ type: "text", text: "Runtime error: spawn claude ENOENT" }], {
          failed: true,
        }),
      ],
    });

    const bad = assistantOf("bad");
    expect(bad.getAttribute("data-failed")).toBe("true");
    expect(within(bad).getByTestId("assistant-message-failed").textContent).toBe(
      "This turn failed",
    );
    expect(bad.textContent).toContain("Runtime error: spawn claude ENOENT");
    expect(bad.querySelector(".text-blocked")).not.toBeNull();
    const good = assistantOf("good");
    expect(good.getAttribute("data-failed")).toBeNull();
    expect(within(good).queryByTestId("assistant-message-failed")).toBeNull();
  });
});

describe("what the agent did", () => {
  const messages = [
    reply("brief", 1),
    reply("done", 2),
    userMessage("steer", 3),
    reply("later", 4),
  ];

  test("shows the work log of a reply above that reply, and only that reply's", () => {
    renderList({
      messages,
      workLogOf: (id) => (id === "later" ? <div data-testid="log-later">2 tool calls</div> : null),
    });

    expect(screen.getAllByTestId("log-later")).toHaveLength(1);
    const later = assistantOf("later");
    const log = within(later).getByTestId("log-later");
    const words = within(later).getByTestId("message-blocks");
    // Above the words, in the same row.
    expect(log.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(assistantOf("brief")).queryByTestId("log-later")).toBeNull();
    expect(within(assistantOf("done")).queryByTestId("log-later")).toBeNull();
  });

  test("draws a log in an assistant's reply only, never in the person's message", () => {
    renderList({
      messages,
      workLogOf: (id) => <div data-testid={`log-${id}`}>log</div>,
    });

    expect(screen.getByTestId("log-brief")).toBeTruthy();
    expect(screen.getByTestId("log-done")).toBeTruthy();
    expect(screen.getByTestId("log-later")).toBeTruthy();
    expect(screen.queryByTestId("log-steer")).toBeNull();
  });

  test("shows the running turn's log inside the working row", () => {
    renderList({
      messages: [userMessage("u1", 1)],
      working: true,
      worker: THREAD_WORKER,
      liveWorkLog: <div data-testid="live-log">1 tool call · Bash</div>,
    });

    expect(within(screen.getByTestId("thread-activity")).getByTestId("live-log")).toBeTruthy();
  });

  test("shows no live log when the agent is not working", () => {
    renderList({
      messages: [userMessage("u1", 1), reply("a1", 2)],
      working: false,
      liveWorkLog: <div data-testid="live-log">1 tool call</div>,
    });

    expect(screen.queryByTestId("live-log")).toBeNull();
  });
});

describe("how long the agent has been working", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const elapsed = () => screen.getByTestId("thread-working").textContent ?? "";

  test("is counted from the message that started the turn", () => {
    renderList({
      messages: [userMessage("steer", 0, { threadId: "thr_1", createdAt: ago(95_000) })],
      working: true,
      worker: THREAD_WORKER,
    });

    expect(elapsed()).toMatch(/Claude Code is working · 1m \d\ds/);
  });

  test("is counted from workingSince when no message on screen started the turn (a thread's first)", () => {
    renderList({
      messages: [reply("brief", 0, undefined, { threadId: "thr_1", createdAt: ago(1_000) })],
      working: true,
      worker: THREAD_WORKER,
      workingSince: ago(12_000),
    });

    expect(elapsed()).toMatch(/Claude Code is working · 1[2-5]s/);
  });

  test("a message that started the turn wins over workingSince", () => {
    renderList({
      messages: [userMessage("steer", 0, { threadId: "thr_1", createdAt: ago(95_000) })],
      working: true,
      worker: THREAD_WORKER,
      workingSince: ago(3_000),
    });

    expect(elapsed()).toMatch(/· 1m/);
  });

  test("says no time when it does not know when the turn began", () => {
    renderList({
      messages: [reply("brief", 0, undefined, { threadId: "thr_1" })],
      working: true,
      worker: THREAD_WORKER,
    });

    expect(elapsed().trim()).toBe("Claude Code is working");
  });
});

describe("older messages the host still holds", () => {
  const thread = (count: number) =>
    Array.from({ length: count }, (_, index) => userMessage(`m${index + 1}`, index + 1));
  const earlierOf = (overrides: Partial<EarlierMessages> = {}): EarlierMessages => ({
    available: true,
    loading: false,
    error: null,
    load: async () => {},
    ...overrides,
  });
  const drawn = () => screen.getAllByTestId("user-message").map((row) => row.dataset.messageId);

  test("offers to load them once everything held is drawn, and not before", () => {
    renderList({ messages: thread(70), earlier: earlierOf() });

    expect(screen.getByTestId("chat-show-earlier")).toBeTruthy();
    expect(screen.queryByTestId("chat-load-earlier")).toBeNull();
    fireEvent.click(screen.getByTestId("chat-show-earlier"));
    expect(screen.queryByTestId("chat-show-earlier")).toBeNull();
    expect(screen.getByTestId("chat-load-earlier").textContent).toBe("Load earlier messages");
  });

  test("offers nothing when the host holds nothing older", () => {
    renderList({ messages: thread(3), earlier: earlierOf({ available: false }) });

    expect(screen.queryByTestId("chat-load-earlier")).toBeNull();
  });

  test("asks for them on click and draws a step of what came, at the top", async () => {
    const all = thread(200);
    const load = mock(async () => {});
    const { rerender } = renderList({ messages: all.slice(150), earlier: earlierOf({ load }) });
    expect(drawn()).toHaveLength(50);

    fireEvent.click(screen.getByTestId("chat-load-earlier"));
    expect(load).toHaveBeenCalledTimes(1);
    rerender(
      <MessageList
        live={{}}
        working={false}
        firstNewId={null}
        scrollToEndKey={0}
        messages={all}
        earlier={earlierOf({ load })}
      />,
    );

    await waitFor(() => expect(drawn()).toHaveLength(120));
    expect(drawn()[0]).toBe("m81");
    expect(screen.getByTestId("chat-show-earlier").textContent).toContain("earlier messages");
  });

  test("says it is loading and cannot be asked again meanwhile", () => {
    renderList({ messages: thread(3), earlier: earlierOf({ loading: true }) });

    const button = screen.getByTestId("chat-load-earlier") as HTMLButtonElement;
    expect(button.textContent).toBe("Loading earlier messages…");
    expect(button.disabled).toBe(true);
  });

  test("says why a fetch failed, and the button asks again", () => {
    renderList({ messages: thread(3), earlier: earlierOf({ error: "Host unreachable" }) });

    expect(screen.getByTestId("chat-load-earlier-error").textContent).toBe(
      "Could not load earlier messages (Host unreachable).",
    );
    expect((screen.getByTestId("chat-load-earlier") as HTMLButtonElement).disabled).toBe(false);
  });
});
