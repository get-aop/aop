import { beforeEach, describe, expect, test } from "bun:test";
import {
  getChatUnreadSnapshot,
  receiveChatUnread,
  resetChatUnreadStore,
  setActiveChatSession,
  subscribeChatUnreadSessionIncrement,
} from "./use-chat-unread";

describe("chat unread store", () => {
  beforeEach(resetChatUnreadStore);

  test("counts background completions and clears them on open", () => {
    setActiveChatSession("active", true);
    receiveChatUnread({
      sessionId: "background",
      title: "Background",
      snippet: "Finished",
      kind: "assistant-final",
    });
    expect(getChatUnreadSnapshot().total).toBe(1);
    setActiveChatSession("background", true);
    expect(getChatUnreadSnapshot().total).toBe(0);
  });

  test("does not count the active visible session", () => {
    setActiveChatSession("active", true);
    receiveChatUnread({
      sessionId: "active",
      title: "Active",
      snippet: "Finished",
      kind: "task-done",
    });
    expect(getChatUnreadSnapshot().total).toBe(0);
  });

  test("notifies session-increment listeners for background completions", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeChatUnreadSessionIncrement((sessionId) => {
      seen.push(sessionId);
    });
    setActiveChatSession("active", true);
    receiveChatUnread({
      sessionId: "background",
      title: "Background",
      snippet: "Finished",
      kind: "assistant-final",
    });
    receiveChatUnread({
      sessionId: "active",
      title: "Active",
      snippet: "Finished",
      kind: "assistant-final",
    });
    expect(seen).toEqual(["background"]);
    unsubscribe();
  });
});
