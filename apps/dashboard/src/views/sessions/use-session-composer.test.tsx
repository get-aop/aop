import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatSessionDetail } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const sendChatWithOptimistic = mock(async (_input: Record<string, unknown>) => {});
const actualModel = await import("./sessions-page-model");

mock.module("./sessions-page-model", () => ({
  ...actualModel,
  sendChatWithOptimistic,
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useSessionComposer } = await import("./use-session-composer");
const { clearSessionComposerDraft, updateSessionComposerDraft } = await import(
  "./session-composer-drafts"
);
const { addSessionReviewComment, getSessionReviewQueue, resetSessionReviewQueueCacheForTests } =
  await import("./session-review-queue");

const composerInput = (sessionId: string) => ({
  active: { id: sessionId, messages: [] } as unknown as ChatSessionDetail,
  typing: false,
  setTyping: () => {},
  setStreamProgress: () => {},
  setDetail: () => {},
  setMidRunHints: () => {},
  showToast: () => {},
  refreshList: async () => {},
});

const queueComment = (sessionId: string, note: string, newNo: number) =>
  addSessionReviewComment(sessionId, {
    path: "src/a.ts",
    lineType: "add",
    oldNo: null,
    newNo,
    excerpt: `line ${newNo}`,
    note,
  });

beforeEach(() => {
  sendChatWithOptimistic.mockClear();
  sendChatWithOptimistic.mockImplementation(async () => {});
  localStorage.clear();
  resetSessionReviewQueueCacheForTests();
});

afterEach(() => {
  cleanup();
});

describe("useSessionComposer review queue drain", () => {
  test("send serializes queued comments before typed text and clears the queue", async () => {
    const sessionId = "sess-drain";
    queueComment(sessionId, "first note", 3);
    queueComment(sessionId, "second note", 8);
    updateSessionComposerDraft(sessionId, (draft) => ({ ...draft, input: "also fix naming" }));
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));

    await act(async () => {
      await result.current.send();
    });

    expect(sendChatWithOptimistic).toHaveBeenCalledTimes(1);
    const sent = sendChatWithOptimistic.mock.calls[0]?.[0] as { content: string };
    expect(sent.content).toBe(
      [
        "Review comments on the current diff:",
        "",
        "### src/a.ts:3",
        "```",
        "line 3",
        "```",
        "first note",
        "",
        "### src/a.ts:8",
        "```",
        "line 8",
        "```",
        "second note",
        "",
        "also fix naming",
      ].join("\n"),
    );
    expect(getSessionReviewQueue(sessionId)).toHaveLength(0);
    clearSessionComposerDraft(sessionId);
  });

  test("empty input with a non-empty queue still sends", async () => {
    const sessionId = "sess-empty-input";
    queueComment(sessionId, "only comment", 5);
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));

    await act(async () => {
      await result.current.send();
    });

    expect(sendChatWithOptimistic).toHaveBeenCalledTimes(1);
    const sent = sendChatWithOptimistic.mock.calls[0]?.[0] as { content: string };
    expect(sent.content).toBe(
      "Review comments on the current diff:\n\n### src/a.ts:5\n```\nline 5\n```\nonly comment",
    );
    expect(getSessionReviewQueue(sessionId)).toHaveLength(0);
  });

  test("empty input and empty queue does not send", async () => {
    const sessionId = "sess-noop";
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));
    await act(async () => {
      await result.current.send();
    });
    expect(sendChatWithOptimistic).not.toHaveBeenCalled();
  });

  test("slash commands send verbatim and keep the review queue", async () => {
    const sessionId = "sess-slash";
    queueComment(sessionId, "stay queued", 4);
    updateSessionComposerDraft(sessionId, (draft) => ({ ...draft, input: "/clear" }));
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));

    await act(async () => {
      await result.current.send();
    });

    expect(sendChatWithOptimistic).toHaveBeenCalledTimes(1);
    const sent = sendChatWithOptimistic.mock.calls[0]?.[0] as { content: string };
    // No review block prepended: the server must see the bare command.
    expect(sent.content).toBe("/clear");
    // The queue is not drained by command sends.
    expect(getSessionReviewQueue(sessionId)).toHaveLength(1);
    clearSessionComposerDraft(sessionId);
  });

  test("failed send restores the queue and only the typed text", async () => {
    const sessionId = "sess-fail";
    queueComment(sessionId, "keep me", 2);
    updateSessionComposerDraft(sessionId, (draft) => ({ ...draft, input: "typed text" }));
    sendChatWithOptimistic.mockImplementation(async (input: Record<string, unknown>) => {
      // Mirror the real model's failure path: optimistic cleanup then draft restore.
      const restore = input.restoreFailedDraft as (failed: Record<string, unknown>) => void;
      restore({
        content: input.content,
        images: [],
        documents: [],
        runtimeDelegation: null,
        runtimeActions: [],
        workflowSelection: null,
      });
    });
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));

    await act(async () => {
      await result.current.send();
    });

    const restored = getSessionReviewQueue(sessionId);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.note).toBe("keep me");
    expect(result.current.input).toBe("typed text");
    clearSessionComposerDraft(sessionId);
  });

  test("exposes update and remove for queued comments", async () => {
    const sessionId = "sess-edit";
    const added = queueComment(sessionId, "original", 1);
    const { result } = renderHook(() => useSessionComposer(composerInput(sessionId)));
    expect(result.current.reviewComments).toHaveLength(1);

    act(() => {
      result.current.updateReviewComment(added.id, "edited");
    });
    expect(result.current.reviewComments[0]?.note).toBe("edited");

    act(() => {
      result.current.removeReviewComment(added.id);
    });
    expect(result.current.reviewComments).toHaveLength(0);
  });

  test("sends compact paste tokens but shows expanded text in the optimistic bubble", async () => {
    const sessionId = "sess-paste";
    const body = ["one", "two", "three", "four", "five"].join("\n");
    updateSessionComposerDraft(sessionId, (draft) => ({
      ...draft,
      input: "review\n[paste #1 +5 lines]\nplease",
      pastes: [{ id: "p1", index: 1, lineCount: 5, content: body }],
    }));
    const messages: Array<{ content: string }> = [];
    const setDetail = mock(
      (updater: (current: ChatSessionDetail | null) => ChatSessionDetail | null) => {
        const next = updater({
          id: sessionId,
          messages: [],
        } as unknown as ChatSessionDetail);
        if (next?.messages[0]) messages.push({ content: next.messages[0].content });
      },
    );
    const { result } = renderHook(() =>
      useSessionComposer({ ...composerInput(sessionId), setDetail }),
    );

    await act(async () => {
      await result.current.send();
    });

    expect(sendChatWithOptimistic).toHaveBeenCalledTimes(1);
    const sent = sendChatWithOptimistic.mock.calls[0]?.[0] as {
      content: string;
      requestContent: string;
      pastesSnapshot: Array<{ index: number; lineCount: number; content: string }>;
    };
    // Wire still ships compact tokens + paste bodies for storage/runtime.
    expect(sent.content).toBe("review\n[paste #1 +5 lines]\nplease");
    expect(sent.requestContent).toBe("review\n[paste #1 +5 lines]\nplease");
    expect(sent.pastesSnapshot).toEqual([{ index: 1, lineCount: 5, content: body }]);
    // Chat bubble shows the full paste, not the placeholder.
    expect(messages[0]?.content).toBe(`review\n${body}\nplease`);
    clearSessionComposerDraft(sessionId);
  });
});
