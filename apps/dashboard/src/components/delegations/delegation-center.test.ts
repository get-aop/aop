import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatDelegationRunDto } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  close(): void {
    this.closed = true;
  }
}

const delegation = (overrides: Partial<ChatDelegationRunDto> = {}): ChatDelegationRunDto => ({
  id: "del_1",
  kind: "delegation",
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
  reasoning: "high",
  fastMode: false,
  status: "active",
  activity: null,
  runtimeSessionId: null,
  logFilePath: "/tmp/delegate.jsonl",
  error: null,
  startedAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  hostRunId: "crun_1",
  hostRunStatus: "running",
  sessionId: "isess_1",
  sessionTitle: "Host session",
  ...overrides,
});

let seedDelegations: ChatDelegationRunDto[] = [];
let sessionDelegations: ChatDelegationRunDto[] = [];

const actualClient = await import("../../api/client");
mock.module("../../api/client", () => ({
  ...actualClient,
  listActiveChatDelegations: async () => seedDelegations,
  listChatDelegations: async () => sessionDelegations,
}));

const {
  closeDelegationDetail,
  dismissDelegationCard,
  getAllDelegationCards,
  getDelegationCards,
  getOpenDelegationId,
  ingestDelegationSessionEvent,
  initDelegationCenter,
  markDelegationHostRunTerminal,
  openDelegationDetail,
  resetDelegationCenter,
  reconcileSessionDelegationsAfterHostFinal,
  selectActiveSessionDelegations,
  setDelegationSessionFocus,
} = await import("./delegation-center");

beforeEach(() => {
  MockEventSource.instances = [];
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  localStorage.clear();
  seedDelegations = [];
  sessionDelegations = [];
  resetDelegationCenter();
});

afterEach(() => {
  resetDelegationCenter();
});

describe("delegation-center", () => {
  test("seeds cards from persisted active runs on init (refresh rebuild)", async () => {
    seedDelegations = [
      delegation(),
      delegation({ id: "del_done", status: "completed", sessionId: "isess_2" }),
    ];

    await initDelegationCenter();

    setDelegationSessionFocus("isess_1");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_1"]);
    setDelegationSessionFocus("isess_2");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_done"]);
    // A stream is opened only for the session with an active delegation.
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/chat-sessions/isess_1/stream");
  });

  test("applies persisted dismissals when rebuilding", async () => {
    localStorage.setItem("aop:delegation-cards-dismissed", JSON.stringify(["del_done"]));
    seedDelegations = [delegation(), delegation({ id: "del_done", status: "completed" })];

    await initDelegationCenter();

    setDelegationSessionFocus("isess_1");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_1"]);
    // The completed card in the other session stays dismissed.
    setDelegationSessionFocus("isess_2");
    expect(getDelegationCards()).toEqual([]);
  });

  test("delegation-updated upserts and opens a stream for new active sessions", async () => {
    await initDelegationCenter();
    expect(MockEventSource.instances).toHaveLength(0);

    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation(),
    });
    setDelegationSessionFocus("isess_1");

    expect(getDelegationCards()).toHaveLength(1);
    expect(MockEventSource.instances.map((source) => source.url)).toEqual([
      "/api/chat-sessions/isess_1/stream",
    ]);
  });

  test("delegation-progress feeds the live output buffer of a known delegation", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");

    ingestDelegationSessionEvent({
      type: "delegation-progress",
      sessionId: "isess_1",
      delegationId: "del_1",
      thinking: "pondering",
      content: "half an answer",
      commandGroups: [],
    });

    const card = getDelegationCards()[0];
    expect(card?.live).toEqual({
      thinking: "pondering",
      content: "half an answer",
      commandGroups: [],
    });
  });

  test("stream events arriving on the session stream update cards", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");
    const source = MockEventSource.instances[0];
    expect(source).toBeTruthy();

    source?.emit("delegation-updated", {
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({ status: "completed" }),
    });

    expect(getDelegationCards()[0]?.delegation.status).toBe("completed");
    // No active delegations left: the stream is closed.
    expect(source?.closed).toBe(true);
  });

  test("assistant-final repairs a card that missed its terminal delegation update", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");
    const source = MockEventSource.instances[0];

    source?.emit("assistant-final", {
      type: "assistant-final",
      sessionId: "isess_1",
      message: { runId: "crun_1", runStatus: "failed" },
    });

    expect(getDelegationCards()[0]?.delegation).toMatchObject({
      status: "cancelled",
      hostRunStatus: "failed",
    });
    expect(selectActiveSessionDelegations(getAllDelegationCards(), "isess_1")).toEqual([]);
    expect(source?.closed).toBe(true);
  });

  test("dismiss hides the card without touching the runtime", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");

    dismissDelegationCard("del_1");

    expect(getDelegationCards()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("aop:delegation-cards-dismissed") ?? "[]")).toEqual([
      "del_1",
    ]);
    // The run keeps streaming — dismissal is purely visual.
    expect(MockEventSource.instances[0]?.closed).toBe(false);
  });

  test("completed explicit delegations stay visible until dismissed", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");

    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({ status: "completed" }),
    });

    expect(getDelegationCards()).toHaveLength(1);
    expect(getDelegationCards()[0]?.delegation.status).toBe("completed");
  });

  test("hides model-spawned task cards when their host conversation finishes", async () => {
    seedDelegations = [
      delegation({ id: "del_done", kind: "background-task", status: "completed" }),
      delegation({ id: "del_failed", kind: "background-task", status: "failed" }),
      delegation({ id: "del_explicit", status: "completed" }),
    ];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");
    openDelegationDetail("del_done");

    expect(
      getDelegationCards()
        .map((card) => card.delegation.id)
        .sort(),
    ).toEqual(["del_done", "del_explicit", "del_failed"]);

    markDelegationHostRunTerminal("crun_1", "completed");

    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_explicit"]);
    expect(getOpenDelegationId()).toBeNull();
  });

  test("shows only the five most recent background tasks", async () => {
    seedDelegations = [
      delegation({ id: "del_regular" }),
      ...Array.from({ length: 6 }, (_, index) =>
        delegation({
          id: `bg_${index + 1}`,
          kind: "background-task",
          startedAt: `2026-07-16T10:0${index}:00.000Z`,
          updatedAt: `2026-07-16T10:0${index}:00.000Z`,
        }),
      ),
    ];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");

    const ids = getDelegationCards().map((card) => card.delegation.id);
    expect(ids).toHaveLength(6);
    expect(ids).not.toContain("bg_1");
    expect(ids).toContain("del_regular");

    dismissDelegationCard("bg_6");
    expect(getDelegationCards().map((card) => card.delegation.id)).not.toContain("bg_1");
  });

  test("a failed transition re-shows a dismissed card until acknowledged", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    setDelegationSessionFocus("isess_1");
    dismissDelegationCard("del_1");
    expect(getDelegationCards()).toHaveLength(0);

    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_1",
      hostRunId: "crun_1",
      delegation: delegation({ status: "failed", error: "boom" }),
    });

    const cards = getDelegationCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.delegation.status).toBe("failed");
    expect(JSON.parse(localStorage.getItem("aop:delegation-cards-dismissed") ?? "[]")).toEqual([]);
  });

  test("tracks delegations from multiple sessions independently", async () => {
    seedDelegations = [
      delegation({ id: "del_a", sessionId: "isess_a" }),
      delegation({ id: "del_b", sessionId: "isess_b", label: "Review", kind: "quick-action" }),
    ];

    await initDelegationCenter();

    expect(getAllDelegationCards()).toHaveLength(2);
    setDelegationSessionFocus("isess_a");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_a"]);
    expect(MockEventSource.instances.map((source) => source.url).sort()).toEqual([
      "/api/chat-sessions/isess_a/stream",
      "/api/chat-sessions/isess_b/stream",
    ]);

    ingestDelegationSessionEvent({
      type: "delegation-updated",
      sessionId: "isess_a",
      hostRunId: "crun_1",
      delegation: delegation({ id: "del_a", sessionId: "isess_a", status: "completed" }),
    });

    expect(
      getAllDelegationCards()
        .map((card) => card.delegation.status)
        .sort(),
    ).toEqual(["active", "completed"]);
    const remaining = MockEventSource.instances.filter((source) => !source.closed);
    expect(remaining.map((source) => source.url)).toEqual(["/api/chat-sessions/isess_b/stream"]);
  });

  test("open and close detail state is shared between card stack and chat row", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();

    expect(getOpenDelegationId()).toBeNull();
    openDelegationDetail("del_1");
    expect(getOpenDelegationId()).toBe("del_1");
    closeDelegationDetail();
    expect(getOpenDelegationId()).toBeNull();
  });

  test("reset clears the open detail along with the cards", async () => {
    seedDelegations = [delegation()];
    await initDelegationCenter();
    openDelegationDetail("del_1");

    resetDelegationCenter();

    expect(getOpenDelegationId()).toBeNull();
    expect(getDelegationCards()).toHaveLength(0);
  });

  test("selectActiveSessionDelegations returns only active delegations for the session", async () => {
    seedDelegations = [
      delegation({ id: "del_a", sessionId: "isess_a" }),
      delegation({ id: "del_b", sessionId: "isess_a", status: "completed" }),
      delegation({ id: "del_c", sessionId: "isess_b" }),
      delegation({ id: "del_d", sessionId: "isess_a" }),
      delegation({ id: "del_stale", sessionId: "isess_a", hostRunStatus: "completed" }),
    ];
    await initDelegationCenter();

    const active = selectActiveSessionDelegations(getAllDelegationCards(), "isess_a");
    expect(active.map((card) => card.delegation.id).sort()).toEqual(["del_a", "del_d"]);
    expect(selectActiveSessionDelegations(getAllDelegationCards(), "isess_none")).toEqual([]);
  });

  test("selectActiveSessionDelegations ignores active rows whose host turn already ended", async () => {
    seedDelegations = [
      delegation({ id: "del_live", sessionId: "isess_a", hostRunStatus: "running" }),
      delegation({
        id: "del_stuck",
        sessionId: "isess_a",
        status: "active",
        hostRunStatus: "completed",
      }),
    ];
    await initDelegationCenter();

    // Upsert remaps stuck rows to cancelled; selector also requires host running.
    expect(
      getAllDelegationCards().find((card) => card.delegation.id === "del_stuck")?.delegation,
    ).toMatchObject({ status: "cancelled" });
    expect(
      selectActiveSessionDelegations(getAllDelegationCards(), "isess_a").map(
        (c) => c.delegation.id,
      ),
    ).toEqual(["del_live"]);
  });

  test("reconcileSessionDelegationsAfterHostFinal cancels still-active session cards", async () => {
    seedDelegations = [
      delegation({ id: "del_a", sessionId: "isess_a" }),
      delegation({ id: "del_b", sessionId: "isess_a" }),
      delegation({ id: "del_other", sessionId: "isess_b" }),
    ];
    await initDelegationCenter();

    reconcileSessionDelegationsAfterHostFinal("isess_a");

    expect(
      getAllDelegationCards().find((c) => c.delegation.id === "del_a")?.delegation,
    ).toMatchObject({
      status: "cancelled",
      hostRunStatus: "completed",
    });
    expect(
      getAllDelegationCards().find((c) => c.delegation.id === "del_b")?.delegation.status,
    ).toBe("cancelled");
    expect(
      getAllDelegationCards().find((c) => c.delegation.id === "del_other")?.delegation.status,
    ).toBe("active");
    expect(selectActiveSessionDelegations(getAllDelegationCards(), "isess_a")).toEqual([]);
  });

  test("cards are scoped to the focused session and hidden elsewhere", async () => {
    seedDelegations = [
      delegation({ id: "del_a", sessionId: "isess_a" }),
      delegation({ id: "del_b", sessionId: "isess_b", label: "Review", kind: "quick-action" }),
    ];
    await initDelegationCenter();

    // No session in focus (e.g. Board page): nothing shows.
    expect(getDelegationCards()).toEqual([]);

    setDelegationSessionFocus("isess_a");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_a"]);

    // Switching sessions hides the previous card without losing it.
    setDelegationSessionFocus("isess_b");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_b"]);

    // Navigating away from sessions hides cards; state survives for the return.
    setDelegationSessionFocus(null);
    expect(getDelegationCards()).toEqual([]);
    setDelegationSessionFocus("isess_a");
    expect(getDelegationCards().map((card) => card.delegation.id)).toEqual(["del_a"]);
  });

  test("focusing a session loads historical cards from the session delegations API", async () => {
    sessionDelegations = [
      delegation({
        id: "del_bg_old",
        kind: "background-task",
        label: "Historical explore",
        status: "completed",
        hostRunStatus: "completed",
        sessionId: "isess_old",
      }),
    ];
    await initDelegationCenter();
    expect(getAllDelegationCards()).toHaveLength(0);

    setDelegationSessionFocus("isess_old");
    // Session fetch is async; wait a tick for the mock resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(getAllDelegationCards().map((card) => card.delegation.id)).toEqual(["del_bg_old"]);
    expect(getDelegationCards()).toEqual([]);
  });
});
