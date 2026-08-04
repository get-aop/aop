import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTaskEventEmitter, resetTaskEventEmitter } from "../events/task-events";
import {
  type ChatSessionEvent,
  createChatSessionEventQueue,
  getLatestChatSessionProgress,
  publishAssistantProgress,
  publishChatSessionEvent,
  resetAssistantProgress,
  subscribeChatSession,
  suffixDelta,
} from "./session-events";

const progress = (n: number): ChatSessionEvent => ({
  type: "assistant-progress",
  sessionId: "s1",
  thinking: "",
  content: `p${n}`,
  commandGroups: [],
});

const typing = (): ChatSessionEvent => ({
  type: "assistant-typing",
  sessionId: "s1",
  userMessageId: "m1",
});

describe("createChatSessionEventQueue", () => {
  test("sends at most one event at a time", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];

    const queue = createChatSessionEventQueue(async (event) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (sent.length === 0) await gate;
      sent.push(event.type === "assistant-progress" ? event.content : event.type);
      active -= 1;
    });

    queue.push(progress(1));
    queue.push(progress(2));
    await Bun.sleep(5);
    expect(maxActive).toBe(1);
    expect(sent).toEqual([]);

    release?.();
    await Bun.sleep(10);
    expect(maxActive).toBe(1);
    expect(sent).toEqual(["p1", "p2"]);
  });

  test("coalesces consecutive unsent progress by concatenating deltas", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];

    const queue = createChatSessionEventQueue(async (event) => {
      if (sent.length === 0) await gate;
      sent.push(event.type === "assistant-progress" ? event.content : event.type);
    });

    queue.push(progress(1));
    queue.push(progress(2));
    queue.push(progress(3));
    release?.();
    await Bun.sleep(10);

    // Deltas concatenate exactly, so coalescing stays lossless (the first
    // frame was already dequeued by the drain before the later merges).
    expect(sent).toEqual(["p1", "p2p3"]);
  });

  test("non-progress events act as coalescing barriers", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];

    const queue = createChatSessionEventQueue(async (event) => {
      if (sent.length === 0) await gate;
      sent.push(event.type === "assistant-progress" ? event.content : event.type);
    });

    queue.push(progress(1));
    queue.push(progress(2));
    queue.push(typing());
    queue.push(progress(3));
    release?.();
    await Bun.sleep(10);

    expect(sent).toEqual(["p1", "p2", "assistant-typing", "p3"]);
  });

  test("clear drops queued work and ignores later pushes", async () => {
    const send = mock(async () => {});
    const queue = createChatSessionEventQueue(send);

    queue.clear();
    queue.push(progress(1));
    await Bun.sleep(5);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("chat session global events", () => {
  beforeEach(resetTaskEventEmitter);

  test("bridges assistant completion to a global unread event", () => {
    const events: unknown[] = [];
    getTaskEventEmitter().subscribe((event) => events.push(event));

    publishChatSessionEvent({
      type: "assistant-final",
      sessionId: "session-1",
      sessionTitle: "Build fix",
      message: {
        id: "message-1",
        sessionId: "session-1",
        role: "assistant",
        content: "All checks pass",
        action: null,
        createdAt: "2026-01-01",
        images: [],
        documents: [],
      },
    });

    expect(events).toContainEqual({
      type: "chat-unread",
      sessionId: "session-1",
      title: "Build fix",
      snippet: "All checks pass",
      kind: "assistant-final",
    });
  });
});

describe("publishAssistantProgress", () => {
  beforeEach(() => {
    resetAssistantProgress("s1");
  });

  test("emits suffix deltas relative to the previous frame", () => {
    const received: ChatSessionEvent[] = [];
    const unsubscribe = subscribeChatSession("s1", (event) => received.push(event));

    publishAssistantProgress("s1", { thinking: "pond", content: "Hello world", commandGroups: [] });
    publishAssistantProgress("s1", {
      thinking: "ponder",
      content: "Hello world again",
      commandGroups: [],
    });

    expect(
      received.map((event) => [
        event.type,
        event.type === "assistant-progress" ? event.content : "",
      ]),
    ).toEqual([
      ["assistant-progress", "Hello world"],
      ["assistant-progress", " again"],
    ]);
    unsubscribe();
  });

  test("suffixDelta returns the appended suffix only", () => {
    expect(suffixDelta("Hello", "Hello world")).toBe(" world");
    expect(suffixDelta("Hello", "Completely different")).toBe("Completely different");
    expect(suffixDelta("", "Fresh start")).toBe("Fresh start");
  });

  test("replay frame carries the full cumulative text with replace flag", () => {
    publishAssistantProgress("s1", { thinking: "a", content: "one", commandGroups: [] });
    publishAssistantProgress("s1", { thinking: "ab", content: "one two", commandGroups: [] });

    const latest = getLatestChatSessionProgress("s1");
    expect(latest?.replace).toBe(true);
    expect(latest?.content).toBe("one two");
    expect(latest?.thinking).toBe("ab");
  });

  test("resetAssistantProgress starts a fresh delta chain", () => {
    publishAssistantProgress("s1", { thinking: "a", content: "one", commandGroups: [] });
    resetAssistantProgress("s1");
    publishAssistantProgress("s1", { thinking: "b", content: "two", commandGroups: [] });

    expect(getLatestChatSessionProgress("s1")?.content).toBe("two");
  });
});
