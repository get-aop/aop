import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import { reply, report, userMessage } from "./test-utils";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ChatProvider } = await import("./chat-context");
const { MessageList } = await import("./MessageList");
const { presenceOf } = await import("./thread-presence");

afterEach(cleanup);

const card = (threadId: string) =>
  ({ type: "thread-card", threadId, variant: "needs-call" }) as const;

const renderConversation = (messages: readonly Message[], threads: Thread[]) =>
  render(
    <ChatProvider
      projectId="prj_1"
      projectActive
      threads={threads}
      threadsLoaded
      threadsError={null}
    >
      <MessageList
        messages={messages}
        live={{}}
        working={false}
        firstNewId={null}
        scrollToEndKey={0}
      />
    </ChatProvider>,
  );

describe("presenceOf", () => {
  test("names the newest message with a card, and the newest report, for each thread", () => {
    const presence = presenceOf([
      reply("a1", 1, [card("thr_1"), card("thr_2")]),
      report("r1", 2, { reportedThreadId: "thr_1" }),
      reply("a2", 3, [card("thr_1")]),
      report("r2", 4, { reportedThreadId: "thr_1" }),
      userMessage("u1", 5),
    ]);

    expect(presence.cardMessage.get("thr_1")).toBe("a2");
    expect(presence.cardMessage.get("thr_2")).toBe("a1");
    expect(presence.latestReport.get("thr_1")).toBe("r2");
    expect(presence.latestReport.get("thr_2")).toBeUndefined();
  });
});

describe("a thread in the conversation", () => {
  test("has one card, the newest, showing the thread as it is now; earlier mentions are chips", () => {
    const done = makeThread({ id: "thr_1", title: "Pick a style", status: "idle" });
    renderConversation(
      [
        reply("a1", 1, [card("thr_1")]),
        reply("a2", 2, [card("thr_1")]),
        reply("a3", 3, [card("thr_1")]),
      ],
      [done],
    );

    const cards = screen.getAllByTestId("chat-thread-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-variant")).toBe("done");
    expect(screen.getAllByTestId("chat-thread-card-earlier")).toHaveLength(2);
    expect(screen.getAllByTestId("thread-chip")).toHaveLength(2);
    // The card sits in the last message.
    const last = screen
      .getAllByTestId("assistant-message")
      .find((row) => row.getAttribute("data-message-id") === "a3");
    expect(last?.querySelector("[data-testid=chat-thread-card]")).toBe(cards[0] ?? null);
  });

  test("a card for another thread is not an earlier mention", () => {
    renderConversation(
      [reply("a1", 1, [card("thr_1")]), reply("a2", 2, [card("thr_2")])],
      [makeThread({ id: "thr_1" }), makeThread({ id: "thr_2", title: "Other" })],
    );

    expect(screen.getAllByTestId("chat-thread-card")).toHaveLength(2);
    expect(screen.queryByTestId("chat-thread-card-earlier")).toBeNull();
  });
});

describe("a thread's reports", () => {
  test("only the newest report about a thread stays in the conversation", () => {
    renderConversation(
      [
        report("r1", 1, { outcome: "finished" }),
        report("r2", 2, { outcome: "finished" }),
        report("r3", 3, { outcome: "failed", reportedThreadId: "thr_2" }),
      ],
      [makeThread({ id: "thr_1" }), makeThread({ id: "thr_2", title: "Other" })],
    );

    const ids = screen
      .getAllByTestId("thread-report")
      .map((row) => row.getAttribute("data-message-id"));
    expect(ids).toEqual(["r2", "r3"]);
  });

  test("a call that was answered is gone, and one still waiting stays", () => {
    const answered = makeThread({ id: "thr_1", status: "idle" });
    const waiting = makeThread({ id: "thr_2", title: "Other", status: "waiting-on-you" });
    renderConversation(
      [
        report("r1", 1, { outcome: "needs-you", reportedThreadId: "thr_1" }),
        report("r2", 2, { outcome: "needs-you", reportedThreadId: "thr_2" }),
      ],
      [answered, waiting],
    );

    const rows = screen.getAllByTestId("thread-report");
    expect(rows.map((row) => row.getAttribute("data-message-id"))).toEqual(["r2"]);
  });
});
