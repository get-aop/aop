import { describe, expect, mock, test } from "bun:test";
import type { SetStateAction } from "react";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

// Radix reads `document` when its module evaluates, so the helpers load after the DOM exists.
const {
  ACTIVE_RESET_RUNTIME_MESSAGE,
  bootstrapSessions,
  confirmAndResetRuntimeSession,
  countQueuedSessionMessages,
  handleSessionStreamEvent,
  IDLE_RESET_RUNTIME_MESSAGE,
  pickSessionAfterSettle,
  pickSessionToOpen,
  pinSessionOptimistic,
  RESET_RUNTIME_SUCCESS_TOAST,
  scopeMidRunHintsToMessages,
} = await import("./sessions-page-helpers");
const { clearSessionUnreadCount, incrementSessionUnreadCount } = await import(
  "./use-session-unread-counts"
);
const { SESSION_STREAM_EVENT_TYPES } = await import("./use-sessions-page-effects");

class NullEventSource {
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

globalThis.EventSource = NullEventSource as unknown as typeof EventSource;

const summary = (id: string, settled = false): ChatSessionSummary =>
  ({
    id,
    scope: "repository",
    repoId: "r1",
    repoName: "repo",
    repoPath: "/tmp/repo",
    title: id,
    named: false,
    runtime: "grok-build",
    model: "grok-4.5",
    reasoningEffort: "medium",
    runtimeAlias: null,
    runtimeSessionId: null,
    fastMode: false,
    pinned: false,
    settledOverride: settled ? "settled" : null,
    settledAt: settled ? new Date().toISOString() : null,
    lastActivityAt: null,
    hasPendingApproval: false,
    assistantActive: false,
    snippet: null,
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }) as ChatSessionSummary;

describe("bootstrapSessions", () => {
  test("opens the preferred session from the loaded list", async () => {
    const refreshList = mock(async () => [summary("s1"), summary("s2")]);
    const loadDetail = mock(async (_id: string) => null);

    await bootstrapSessions(refreshList, loadDetail, "s2");

    expect(refreshList).toHaveBeenCalledTimes(1);
    expect(loadDetail.mock.calls).toEqual([["s2"]]);
  });

  test("opens the newest non-settled session when nothing was opened before", async () => {
    sessionStorage.clear();
    const refreshList = mock(async () => [summary("settled", true), summary("live")]);
    const loadDetail = mock(async (_id: string) => null);

    await bootstrapSessions(refreshList, loadDetail);

    expect(loadDetail.mock.calls).toEqual([["live"]]);
  });

  test("opens nothing for an empty session list", async () => {
    sessionStorage.clear();
    const loadDetail = mock(async (_id: string) => null);

    await bootstrapSessions(async () => [], loadDetail);

    expect(loadDetail).not.toHaveBeenCalled();
  });
});

describe("handleSessionStreamEvent", () => {
  test("session stream subscribes only to chat session events", () => {
    expect([...SESSION_STREAM_EVENT_TYPES]).toEqual([
      "connected",
      "assistant-typing",
      "assistant-progress",
      "assistant-final",
      "session-updated",
      "ping",
    ]);
  });

  test("events from removed features are ignored", () => {
    const handlers = {
      activeIdRef: { current: "s1" },
      setTyping: mock(() => {}),
      setStreamProgress: mock(() => {}),
      setDetail: mock(() => {}),
      refreshList: mock(async () => {}),
      reloadDetail: mock(async () => {}),
    };

    handleSessionStreamEvent(
      "terminal-line",
      { sessionId: "s1", text: "$ ls", tone: "cmd" },
      handlers,
    );
    handleSessionStreamEvent("workflow-run-started", { sessionId: "s1", runId: "run_1" }, handlers);
    handleSessionStreamEvent("delegation-updated", { sessionId: "s1" }, handlers);

    expect(handlers.setTyping).not.toHaveBeenCalled();
    expect(handlers.setStreamProgress).not.toHaveBeenCalled();
    expect(handlers.setDetail).not.toHaveBeenCalled();
    expect(handlers.refreshList).not.toHaveBeenCalled();
    expect(handlers.reloadDetail).not.toHaveBeenCalled();
  });

  test("assistant-typing clears the hint for the message whose run started", () => {
    let hints: Record<string, "queued" | "steered"> = {
      queued: "queued",
      waiting: "queued",
    };
    const setMidRunHints = mock((update: SetStateAction<Record<string, "queued" | "steered">>) => {
      hints = typeof update === "function" ? update(hints) : update;
    });

    handleSessionStreamEvent(
      "assistant-typing",
      { sessionId: "s1", userMessageId: "queued" },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail: mock(() => {}),
        setMidRunHints,
        refreshList: mock(async () => {}),
      },
    );

    expect(setMidRunHints).toHaveBeenCalledTimes(1);
    expect(hints).toEqual({ waiting: "queued" });
  });

  test("assistant-typing clears the stale queued disposition on the started message", () => {
    let detail = {
      id: "s1",
      messages: [
        { id: "queued", role: "user", disposition: "queued" },
        { id: "waiting", role: "user", disposition: "queued" },
      ],
    } as unknown as ChatSessionDetail;
    const setDetail = mock((update: SetStateAction<ChatSessionDetail | null>) => {
      detail = (typeof update === "function" ? update(detail) : update) as ChatSessionDetail;
    });

    handleSessionStreamEvent(
      "assistant-typing",
      { sessionId: "s1", userMessageId: "queued" },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail,
        refreshList: mock(async () => {}),
      },
    );

    expect(detail.messages.map((message) => message.disposition)).toEqual(["immediate", "queued"]);
  });

  test("connected skips the duplicate reload after an explicit session load", async () => {
    const reloadDetail = mock(async () => ({ assistantActive: false }));
    const skipConnectedReloadRef = { current: "s1" as string | null };
    const handlers = {
      activeIdRef: { current: "s1" },
      skipConnectedReloadRef,
      setTyping: mock(() => {}),
      setStreamProgress: mock(() => {}),
      setDetail: mock(() => {}),
      refreshList: mock(async () => {}),
      reloadDetail,
    };

    handleSessionStreamEvent("connected", { sessionId: "s1" }, handlers);
    expect(reloadDetail).not.toHaveBeenCalled();
    expect(skipConnectedReloadRef.current).toBeNull();

    handleSessionStreamEvent("connected", { sessionId: "s1" }, handlers);
    await Bun.sleep(0);
    expect(reloadDetail).toHaveBeenCalledWith("s1");
  });

  test("connected clears stale activity after detail recovery completes", async () => {
    const setTyping = mock(() => {});
    const setStreamProgress = mock(() => {});
    const reloadDetail = mock(async () => ({
      assistantActive: false,
      messages: [{ id: "m1", role: "assistant", content: "Recovered answer" }],
    }));
    handleSessionStreamEvent(
      "connected",
      { sessionId: "s1" },
      {
        activeIdRef: { current: "s1" },
        setTyping,
        setStreamProgress,
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
        reloadDetail,
      },
    );
    await Bun.sleep(0);
    expect(reloadDetail).toHaveBeenCalledWith("s1");
    expect(setTyping).toHaveBeenCalledWith(false);
    expect(setStreamProgress).toHaveBeenCalledWith(null);
  });

  test("does not apply a connected refresh after the active session changes", async () => {
    const setTyping = mock(() => {});
    const setStreamProgress = mock(() => {});
    let resolveDetail: ((detail: unknown) => void) | undefined;
    const activeIdRef = { current: "s1" as string | null };
    const reloadDetail = mock(
      () =>
        new Promise<unknown>((resolve) => {
          resolveDetail = resolve;
        }),
    );

    handleSessionStreamEvent(
      "connected",
      { sessionId: "s1" },
      {
        activeIdRef,
        assistantStateGenerationRef: { current: 0 },
        setTyping,
        setStreamProgress,
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
        reloadDetail,
      },
    );
    activeIdRef.current = "s2";
    resolveDetail?.({ assistantActive: true });
    await Bun.sleep(0);

    expect(setTyping).not.toHaveBeenCalled();
    expect(setStreamProgress).not.toHaveBeenCalled();
  });

  test("does not restore typing from a connected refresh after an assistant final", async () => {
    const setTyping = mock(() => {});
    const setStreamProgress = mock(() => {});
    let resolveDetail: ((detail: unknown) => void) | undefined;
    const reloadDetail = mock(
      () =>
        new Promise<unknown>((resolve) => {
          resolveDetail = resolve;
        }),
    );
    const assistantStateGenerationRef = { current: 0 };
    const handlers = {
      activeIdRef: { current: "s1" },
      assistantStateGenerationRef,
      setTyping,
      setStreamProgress,
      setDetail: mock(() => {}),
      refreshList: mock(async () => {}),
      reloadDetail,
    };

    handleSessionStreamEvent("connected", { sessionId: "s1" }, handlers);
    handleSessionStreamEvent(
      "assistant-final",
      { sessionId: "s1", message: { id: "m1", sessionId: "s1", role: "assistant" } },
      handlers,
    );
    resolveDetail?.({ assistantActive: true });
    await Bun.sleep(0);

    expect(setTyping).toHaveBeenLastCalledWith(false);
    expect(setStreamProgress).toHaveBeenLastCalledWith(null);
  });

  test("assistant-progress appends deltas and replaces on replay frames", () => {
    const setTyping = mock(() => {});
    const setStreamProgress = mock((_value: unknown) => {});
    handleSessionStreamEvent(
      "assistant-progress",
      {
        sessionId: "s1",
        thinking: "The user said hey",
        content: "Hello",
      },
      {
        activeIdRef: { current: "s1" },
        setTyping,
        setStreamProgress,
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
      },
    );
    expect(setTyping).toHaveBeenCalledWith(true);
    // Frames carry suffix deltas; the client accumulates them onto prior text.
    const updater = setStreamProgress.mock.calls[0]?.[0] as (current: unknown) => unknown;
    const current = { thinking: "The user ", content: "Hel", commandGroups: [] };
    expect(updater(current)).toEqual({
      thinking: "The user The user said hey",
      content: "HelHello",
      commandGroups: [],
    });
  });

  test("assistant-progress replace frames overwrite accumulated text", () => {
    const setStreamProgress = mock((_value: unknown) => {});
    handleSessionStreamEvent(
      "assistant-progress",
      {
        sessionId: "s1",
        replace: true,
        thinking: "full thinking",
        content: "full content",
        commandGroups: [],
      },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress,
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
      },
    );
    const updater = setStreamProgress.mock.calls[0]?.[0] as (current: unknown) => unknown;
    expect(updater({ thinking: "stale", content: "stale", commandGroups: [] })).toEqual({
      thinking: "full thinking",
      content: "full content",
      commandGroups: [],
    });
  });

  test("assistant-final with session action opens the new session", () => {
    const opened: string[] = [];
    handleSessionStreamEvent(
      "assistant-final",
      {
        sessionId: "s1",
        message: {
          id: "m1",
          sessionId: "s1",
          role: "assistant",
          content: "Settled",
          action: {
            type: "session",
            id: "isess_fresh",
            label: "New session",
            sub: "Same repository",
            meta: "cleared",
          },
          createdAt: new Date().toISOString(),
        },
      },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
        onOpenSession: (id) => opened.push(id),
      },
    );
    expect(opened).toEqual(["isess_fresh"]);
  });

  test("assistant-final clears stream progress", () => {
    const setTyping = mock(() => {});
    const setStreamProgress = mock(() => {});
    handleSessionStreamEvent(
      "assistant-final",
      {
        sessionId: "s1",
        message: {
          id: "m1",
          sessionId: "s1",
          role: "assistant",
          content: "Hello",
          action: null,
          createdAt: new Date().toISOString(),
        },
      },
      {
        activeIdRef: { current: "s1" },
        setTyping,
        setStreamProgress,
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
      },
    );
    expect(setTyping).toHaveBeenCalledWith(false);
    expect(setStreamProgress).toHaveBeenCalledWith(null);
  });

  test("assistant-final replaces an existing message when its persisted action changes", () => {
    let update: SetStateAction<ChatSessionDetail | null> | undefined;
    handleSessionStreamEvent(
      "assistant-final",
      {
        sessionId: "s1",
        message: {
          id: "m1",
          sessionId: "s1",
          role: "assistant",
          content: "Choose a worker",
          action: { type: "task-assignment", status: "confirmed", proposal: {} },
          createdAt: "2026-07-21T00:00:00.000Z",
        },
      },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail: (value) => {
          update = value;
        },
        refreshList: mock(async () => {}),
      },
    );

    const current = {
      id: "s1",
      messages: [
        {
          id: "m1",
          sessionId: "s1",
          role: "assistant",
          content: "Choose a worker",
          action: { type: "task-assignment", status: "proposed", proposal: {} },
          createdAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    } as ChatSessionDetail;
    const next = typeof update === "function" ? update(current) : update;
    expect(next?.messages[0]?.action).toMatchObject({ status: "confirmed" });
  });

  test("session-updated refreshes list and reloads open session detail", () => {
    const refreshList = mock(async () => {});
    const reloadDetail = mock(async () => {});
    handleSessionStreamEvent(
      "session-updated",
      { sessionId: "s1", session: { id: "s1" } },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail: mock(() => {}),
        refreshList,
        reloadDetail,
      },
    );
    expect(refreshList).toHaveBeenCalled();
    expect(reloadDetail).toHaveBeenCalledWith("s1");
  });

  test("assistant-final marks the active session read before refreshing the list", async () => {
    let resolveMarkRead: (() => void) | undefined;
    const onMarkSessionRead = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveMarkRead = resolve;
        }),
    );
    const refreshList = mock(async () => {});
    handleSessionStreamEvent(
      "assistant-final",
      {
        sessionId: "s1",
        message: {
          id: "m1",
          sessionId: "s1",
          role: "assistant",
          content: "done",
          action: null,
          createdAt: new Date().toISOString(),
        },
      },
      {
        activeIdRef: { current: "s1" },
        setTyping: mock(() => {}),
        setStreamProgress: mock(() => {}),
        setDetail: mock(() => {}),
        refreshList,
        onMarkSessionRead,
      },
    );
    expect(onMarkSessionRead).toHaveBeenCalledWith("s1");
    expect(refreshList).not.toHaveBeenCalled();

    resolveMarkRead?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshList).toHaveBeenCalledTimes(1);
  });

  test("clearSessionUnreadCount zeroes only the target session", () => {
    const next = clearSessionUnreadCount(
      [summary("a"), summary("b")].map((session, index) => ({
        ...session,
        unreadCount: index + 1,
      })),
      "a",
    );
    expect(next.find((session) => session.id === "a")?.unreadCount).toBe(0);
    expect(next.find((session) => session.id === "b")?.unreadCount).toBe(2);
  });

  test("incrementSessionUnreadCount skips the active session", () => {
    const sessions = [summary("a"), summary("b")].map((session) => ({
      ...session,
      unreadCount: 1,
    }));
    expect(incrementSessionUnreadCount(sessions, "a", "a")).toEqual(sessions);
    expect(
      incrementSessionUnreadCount(sessions, "b", "a").find((s) => s.id === "b")?.unreadCount,
    ).toBe(2);
  });

  test("ignores typing events for a non-active session", () => {
    const setTyping = mock(() => {});
    handleSessionStreamEvent(
      "assistant-typing",
      { sessionId: "s-other", userMessageId: "m1" },
      {
        activeIdRef: { current: "s-active" },
        setTyping,
        setStreamProgress: mock(() => {}),
        setDetail: mock(() => {}),
        refreshList: mock(async () => {}),
      },
    );
    expect(setTyping).not.toHaveBeenCalled();
  });
});

describe("pickSessionToOpen", () => {
  test("prefers stored session id when still in list", () => {
    const list = [summary("s-new"), summary("s-old")];
    expect(pickSessionToOpen(list, "s-old")).toBe("s-old");
  });

  test("falls back to first non-settled session", () => {
    const list = [summary("settled", true), summary("live")];
    expect(pickSessionToOpen(list, "missing")).toBe("live");
  });

  test("returns null for empty list", () => {
    expect(pickSessionToOpen([])).toBeNull();
  });
});

describe("pickSessionAfterSettle", () => {
  test("selects the next non-settled session when the active session is settled", () => {
    const list = [summary("settled", true), summary("next"), summary("later")];

    expect(pickSessionAfterSettle(list, "settled")).toBe("next");
  });

  test("keeps the current selection when a background session is settled", () => {
    const list = [summary("active"), summary("settled", true)];

    expect(pickSessionAfterSettle(list, "active", "settled")).toBe("active");
  });

  test("clears the selection when no active sessions remain", () => {
    expect(pickSessionAfterSettle([summary("only", true)], "only")).toBeNull();
  });
});

describe("confirmAndResetRuntimeSession", () => {
  test("uses idle vs active confirmation copy", async () => {
    const confirmations: Array<{ message: string }> = [];
    const requestConfirmation = mock(async (opts: { message: string }) => {
      confirmations.push(opts);
      return false;
    });
    const deps = {
      requestConfirmation: requestConfirmation as never,
      resetChatSessionRuntime: mock(async () => ({
        reset: true,
        clearedBinding: true,
        cancelledRun: false,
      })),
    };

    await confirmAndResetRuntimeSession(
      {
        sessionId: "s1",
        activeRun: false,
        isActiveSession: () => true,
        refreshList: mock(async () => []),
        reloadDetailQuiet: mock(async () => null),
        showToast: mock(() => {}),
      },
      deps,
    );
    await confirmAndResetRuntimeSession(
      {
        sessionId: "s1",
        activeRun: true,
        isActiveSession: () => true,
        refreshList: mock(async () => []),
        reloadDetailQuiet: mock(async () => null),
        showToast: mock(() => {}),
      },
      deps,
    );

    expect(confirmations.map((item) => item.message)).toEqual([
      IDLE_RESET_RUNTIME_MESSAGE,
      ACTIVE_RESET_RUNTIME_MESSAGE,
    ]);
    expect(deps.resetChatSessionRuntime).not.toHaveBeenCalled();
  });

  test("on success refreshes list/detail and toasts Runtime session reset", async () => {
    const toasts: string[] = [];
    const refreshList = mock(async () => [summary("s1")]);
    const reloadDetailQuiet = mock(async () => null);
    const resetChatSessionRuntime = mock(async () => ({
      reset: true,
      clearedBinding: true,
      cancelledRun: false,
    }));

    await confirmAndResetRuntimeSession(
      {
        sessionId: "s1",
        activeRun: false,
        isActiveSession: () => true,
        refreshList,
        reloadDetailQuiet,
        showToast: (message) => toasts.push(message),
      },
      {
        requestConfirmation: mock(async () => true) as never,
        resetChatSessionRuntime,
      },
    );

    expect(resetChatSessionRuntime).toHaveBeenCalledWith("s1");
    expect(refreshList).toHaveBeenCalled();
    expect(reloadDetailQuiet).toHaveBeenCalledWith("s1");
    expect(toasts).toEqual([RESET_RUNTIME_SUCCESS_TOAST]);
  });

  test("on failure preserves local state and shows the error toast", async () => {
    const toasts: string[] = [];
    const refreshList = mock(async () => []);
    const reloadDetailQuiet = mock(async () => null);

    await confirmAndResetRuntimeSession(
      {
        sessionId: "s1",
        activeRun: true,
        isActiveSession: () => true,
        refreshList,
        reloadDetailQuiet,
        showToast: (message) => toasts.push(message),
      },
      {
        requestConfirmation: mock(async () => true) as never,
        resetChatSessionRuntime: mock(async () => {
          throw new Error("reset failed");
        }),
      },
    );

    expect(refreshList).not.toHaveBeenCalled();
    expect(reloadDetailQuiet).not.toHaveBeenCalled();
    expect(toasts).toEqual(["reset failed"]);
  });
});

describe("pinSessionOptimistic", () => {
  test("updates the list immediately and keeps it after a successful patch", async () => {
    const sessions = [summary("s1"), summary("s2")];
    let current = sessions;
    const setSessions = mock((value: SetStateAction<ChatSessionSummary[]>) => {
      current = typeof value === "function" ? value(current) : value;
    });
    const patchSession = mock(async () => summary("s1"));

    await pinSessionOptimistic({
      sessionId: "s1",
      pinned: true,
      sessions,
      setSessions,
      patchSession,
      showToast: mock(() => {}),
    });

    expect(setSessions).toHaveBeenCalledTimes(1);
    expect(current.find((session) => session.id === "s1")?.pinned).toBe(true);
    expect(patchSession).toHaveBeenCalledWith("s1", { pinned: true });
  });

  test("restores the prior snapshot and toasts on failure", async () => {
    const sessions = [summary("s1"), { ...summary("s2"), pinned: true }];
    let current = sessions;
    const setSessions = mock((value: SetStateAction<ChatSessionSummary[]>) => {
      current = typeof value === "function" ? value(current) : value;
    });
    const toasts: string[] = [];

    await pinSessionOptimistic({
      sessionId: "s2",
      pinned: false,
      sessions,
      setSessions,
      patchSession: mock(async () => {
        throw new Error("pin failed");
      }),
      showToast: (message) => toasts.push(message),
    });

    expect(setSessions).toHaveBeenCalledTimes(2);
    expect(current).toEqual(sessions);
    expect(current.find((session) => session.id === "s2")?.pinned).toBe(true);
    expect(toasts).toEqual(["pin failed"]);
  });
});

describe("countQueuedSessionMessages", () => {
  const userMessage = (
    id: string,
    disposition?: "immediate" | "queued" | "steered" | "retry",
  ): ChatSessionDetail["messages"][number] =>
    ({
      id,
      sessionId: "s-active",
      role: "user",
      content: id,
      action: null,
      createdAt: new Date().toISOString(),
      disposition,
    }) as ChatSessionDetail["messages"][number];

  test("ignores mid-run hints from another session when counting the active one", () => {
    const activeMessages = [userMessage("msg-active-queued", "queued")];
    const midRunHints = {
      "msg-active-queued": "queued" as const,
      "msg-other-session": "queued" as const,
    };
    expect(countQueuedSessionMessages(activeMessages, midRunHints)).toBe(1);
  });

  test("counts optimistic hints that match active session message ids", () => {
    const activeMessages = [userMessage("msg-optimistic")];
    expect(countQueuedSessionMessages(activeMessages, { "msg-optimistic": "steered" })).toBe(1);
  });

  test("stops counting a message once the server claimed it, despite a stale hint", () => {
    const activeMessages = [
      userMessage("msg-claimed", "immediate"),
      userMessage("msg-two", "queued"),
    ];
    const midRunHints = { "msg-claimed": "queued" as const, "msg-two": "queued" as const };
    expect(countQueuedSessionMessages(activeMessages, midRunHints)).toBe(1);
  });
});

describe("scopeMidRunHintsToMessages", () => {
  const userMessage = (id: string): ChatSessionDetail["messages"][number] =>
    ({
      id,
      sessionId: "s-active",
      role: "user",
      content: id,
      action: null,
      createdAt: new Date().toISOString(),
    }) as ChatSessionDetail["messages"][number];

  test("drops hints that belong to another session after a switch", () => {
    const activeMessages = [userMessage("msg-active")];
    const midRunHints = {
      "msg-active": "queued" as const,
      "msg-other-session": "queued" as const,
    };
    expect(scopeMidRunHintsToMessages(activeMessages, midRunHints)).toEqual({
      "msg-active": "queued",
    });
  });
});
