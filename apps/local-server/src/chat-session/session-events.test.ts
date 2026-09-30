import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ChatSessionEvent,
  getLatestChatSessionProgress,
  publishAssistantProgress,
  publishChatSessionEvent,
  resetAssistantProgress,
  subscribeChatSession,
  suffixDelta,
} from "./session-events";

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

  test("later frames stay suffix deltas and never re-send the full text", () => {
    // Regression: updateLatestProgress used to overwrite the delta-chain
    // baseline with the delta event itself, so every other publish fell back
    // to sending the FULL cumulative text as an append delta and the client
    // duplicated the whole thinking block (observed ~50x in real Pi runs).
    const received: ChatSessionEvent[] = [];
    const unsubscribe = subscribeChatSession("s1", (event) => received.push(event));

    publishAssistantProgress("s1", { thinking: "a", content: "one", commandGroups: [] });
    publishAssistantProgress("s1", { thinking: "ab", content: "one two", commandGroups: [] });
    publishAssistantProgress("s1", {
      thinking: "abc",
      content: "one two three",
      commandGroups: [],
    });
    publishAssistantProgress("s1", {
      thinking: "abcd",
      content: "one two three four",
      commandGroups: [],
    });

    expect(
      received.map((event) =>
        event.type === "assistant-progress"
          ? { thinking: event.thinking, content: event.content }
          : null,
      ),
    ).toEqual([
      { thinking: "a", content: "one" },
      { thinking: "b", content: " two" },
      { thinking: "c", content: " three" },
      { thinking: "d", content: " four" },
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

  test("assistant completion clears reconnect progress", () => {
    publishAssistantProgress("s1", {
      thinking: "Finished thinking",
      content: "Finished answer",
      commandGroups: [],
    });

    publishChatSessionEvent({
      type: "assistant-final",
      sessionId: "s1",
      message: {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        content: "Finished answer",
        action: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        images: [],
        documents: [],
      },
    });

    expect(getLatestChatSessionProgress("s1")).toBeNull();
  });

  test("a reorganized snapshot is sent as a replace frame, never appended", () => {
    // Sealed/replayed text can stop being a strict suffix extension (e.g. a
    // paragraph gets trimmed when sealed). Appending the full snapshot would
    // duplicate the whole stream on the client; a replace frame resets it.
    const received: ChatSessionEvent[] = [];
    const unsubscribe = subscribeChatSession("s1", (event) => received.push(event));

    publishAssistantProgress("s1", { thinking: "a", content: "one two", commandGroups: [] });
    publishAssistantProgress("s1", { thinking: "ab", content: "one two three", commandGroups: [] });
    // Content reorganized: no longer starts with the previous snapshot.
    publishAssistantProgress("s1", { thinking: "abc", content: "reorganized", commandGroups: [] });
    // Clean extension resumes after the replace baseline.
    publishAssistantProgress("s1", {
      thinking: "abcd",
      content: "reorganized!",
      commandGroups: [],
    });

    expect(
      received.map((event) =>
        event.type === "assistant-progress"
          ? {
              replace: event.replace ?? false,
              thinking: event.thinking,
              content: event.content,
            }
          : null,
      ),
    ).toEqual([
      { replace: false, thinking: "a", content: "one two" },
      { replace: false, thinking: "b", content: " three" },
      { replace: true, thinking: "abc", content: "reorganized" },
      { replace: false, thinking: "d", content: "!" },
    ]);
    unsubscribe();
  });
});
