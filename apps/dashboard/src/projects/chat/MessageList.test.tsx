import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Message } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { EarlierMessages } from "./chat-state";
import { liveTurn, reply, userMessage } from "./test-utils";

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
      live: { a1: liveTurn("Reading the threads") },
    });

    expect(screen.getByTestId("coordinator-activity")).toBeTruthy();
    expect(screen.getByTestId("coordinator-working").textContent).toContain(
      "Coordinator is working",
    );
    await waitFor(() => expect(assistantOf("a1").textContent).toContain("Reading"));
    expect(screen.queryByTestId("thread-working")).toBeNull();
    expect(COORDINATOR_WORKER).toEqual({ name: "Coordinator", testIdPrefix: "coordinator" });
  });

  test("a named worker renames the line and its ids: the thread's agent is not the coordinator", async () => {
    renderList({
      messages: [userMessage("u1", 1, { threadId: "thr_1" })],
      working: true,
      live: { a1: liveTurn("Reading the tests") },
      worker: THREAD_WORKER,
    });

    expect(screen.getByTestId("thread-activity")).toBeTruthy();
    expect(screen.getByTestId("thread-working").textContent).toContain("Claude Code is working");
    // The word still arriving waits for its end.
    await waitFor(() => expect(assistantOf("a1").textContent).toContain("Reading the"));
    expect(screen.queryByTestId("coordinator-activity")).toBeNull();
    expect(screen.queryByTestId("coordinator-working")).toBeNull();
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

describe("a reply being written", () => {
  const live = (text: string) => ({ a1: liveTurn(text, "u1") });

  test("is drawn by the reply's own row, which its message takes over in place", () => {
    const { rerender } = renderList({
      messages: [userMessage("u1", 1)],
      working: true,
      live: live("On it"),
    });
    const row = assistantOf("a1");
    expect(row.getAttribute("data-writing")).toBe("true");
    // Its meta waits for the end, keeping its room.
    expect(within(row).queryByTestId("message-meta")).toBeNull();

    rerender(
      <MessageList
        live={{}}
        working={false}
        firstNewId={null}
        scrollToEndKey={0}
        messages={[
          userMessage("u1", 1),
          reply("a1", 2, [{ type: "text", text: "On it" }], { inReplyTo: "u1" }),
        ]}
      />,
    );

    // The same element: nothing was unmounted, so nothing flashes or retypes.
    expect(assistantOf("a1")).toBe(row);
    expect(row.getAttribute("data-writing")).toBeNull();
    expect(within(row).getByTestId("message-meta")).toBeTruthy();
  });

  test("shows its tool calls and reasoning in order, folded", () => {
    renderList({
      messages: [userMessage("u1", 1)],
      working: true,
      live: {
        a1: {
          inReplyTo: "u1",
          parts: [
            { type: "thinking", text: "Where is the retry?" },
            { type: "text", text: "Looking. " },
            { type: "tool", id: "t1", name: "Bash", detail: "rg retry", status: "done" },
            { type: "tool", id: "t2", name: "Read", detail: "retry.ts", status: "running" },
          ],
        },
      },
    });

    const row = assistantOf("a1");
    const order = [
      ...row.querySelectorAll(
        "[data-testid='thinking'],[data-testid='chat-markdown'],[data-testid='tool-run']",
      ),
    ].map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["thinking", "chat-markdown", "tool-run"]);
    expect(within(row).getByTestId("thinking-toggle").textContent).toBe("Thinking");
    expect(within(row).getByTestId("tool-run-summary").textContent).toBe("2 tool calls · Read");
    expect(within(row).queryByTestId("thinking-text")).toBeNull();
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

describe("scroll to latest", () => {
  test("is a row under the transcript, not a float over it, and only while away from the end", () => {
    renderList({ messages: [userMessage("u1", 1), reply("a1", 2)] });
    expect(screen.queryByTestId("chat-scroll-to-end")).toBeNull();

    const scroller = screen.getByTestId("chat-scroll");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 1600;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId("chat-scroll-to-end")).toBeNull();
    scroller.scrollTop = 1200;
    fireEvent.scroll(scroller);

    const pill = screen.getByTestId("chat-scroll-to-end");
    expect(pill.className).not.toContain("absolute");
    expect(pill.parentElement?.contains(scroller)).toBe(false);
    expect(pill.parentElement?.parentElement?.contains(scroller)).toBe(true);
  });
});

describe("a message sent into a turn while it ran", () => {
  const steered = (id: string) =>
    screen
      .getAllByTestId("steered-message")
      .find((row) => row.getAttribute("data-message-id") === id) as HTMLElement;

  test("is drawn inside the reply where the agent took it in, after what it said before", () => {
    renderList({
      messages: [
        userMessage("u1", 1),
        reply(
          "a1",
          3,
          [
            { type: "text", text: "Building for x86" },
            { type: "steer", messageId: "u2" },
            { type: "text", text: "Switched to arm64" },
          ],
          { inReplyTo: "u1" },
        ),
        userMessage("u2", 2, { text: "use arm64", steers: "a1" }),
      ],
    });

    const row = steered("u2");
    expect(row.getAttribute("data-state")).toBe("taken");
    expect(within(row).getByText("use arm64")).toBeTruthy();
    expect(assistantOf("a1").contains(row)).toBe(true);
    // The person's message is not drawn a second time on its own.
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    const text = assistantOf("a1").textContent ?? "";
    expect(text.indexOf("Building for x86")).toBeLessThan(text.indexOf("use arm64"));
    expect(text.indexOf("use arm64")).toBeLessThan(text.indexOf("Switched to arm64"));
  });

  test("waits at the end of the reply being written until the agent takes it in", () => {
    renderList({
      messages: [userMessage("u1", 1), userMessage("u2", 2, { text: "stop", steers: "a1" })],
      working: true,
      live: { a1: liveTurn("Working on it", "u1") },
    });

    const row = steered("u2");
    expect(row.getAttribute("data-state")).toBe("pending");
    expect(within(row).getByTestId("steered-message-caption").textContent).toContain(
      "after its current step",
    );
    expect(assistantOf("a1").contains(row)).toBe(true);
  });

  test("the coordinator's message keeps its card and the person's quote inside the reply", () => {
    renderList({
      messages: [
        userMessage("u1", 1, { threadId: "thr_1" }),
        reply(
          "a1",
          3,
          [
            { type: "text", text: "Building for x86" },
            { type: "steer", messageId: "c1" },
          ],
          { inReplyTo: "u1", threadId: "thr_1" },
        ),
        userMessage("c1", 2, {
          threadId: "thr_1",
          sender: "coordinator",
          quote: "use arm64",
          text: "The person wants arm64.",
          steers: "a1",
        }),
      ],
      worker: THREAD_WORKER,
    });

    const row = steered("c1");
    expect(row.getAttribute("data-sender")).toBe("coordinator");
    expect(row.className).toContain("items-start");
    expect(within(row).getByTestId("sent-message-sender").textContent).toBe("Coordinator");
    expect(within(row).getByTestId("forwarded-quote-text").textContent).toBe("use arm64");
    expect(assistantOf("a1").contains(row)).toBe(true);
  });

  test("a stopped turn that never took it in says so", () => {
    renderList({
      messages: [
        userMessage("u1", 1),
        reply("a1", 3, [{ type: "text", text: "Conversation stopped." }], { inReplyTo: "u1" }),
        userMessage("u2", 2, { text: "stop", steers: "a1" }),
      ],
    });

    expect(steered("u2").getAttribute("data-state")).toBe("missed");
  });
});
