import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
}

type PendingTimer = { callback: () => void; delay: number; cleared: boolean };

const originalEventSource = globalThis.EventSource;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalRandom = Math.random;
let timers: PendingTimer[] = [];

const { createHostEventsConnection } = await import("./events");

const latestSource = (): MockEventSource => {
  const source = MockEventSource.instances.at(-1);
  if (!source) throw new Error("Expected an EventSource instance");
  return source;
};

beforeEach(() => {
  MockEventSource.instances = [];
  timers = [];
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  // Deterministic backoff: no jitter, and retries fire only when the test says so.
  Math.random = () => 0;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const timer: PendingTimer = { callback, delay: delay ?? 0, cleared: false };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((timer: PendingTimer) => {
    timer.cleared = true;
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  Math.random = originalRandom;
});

describe("createHostEventsConnection", () => {
  test("connects to the global host stream and listens for exactly the host event types", () => {
    createHostEventsConnection({ onEvent: mock() });

    expect(latestSource().url).toBe("/api/events");
    expect([...latestSource().listeners.keys()].sort()).toEqual([
      "chat-unread",
      "data-reset",
      "init",
      "repo-removed",
    ]);
  });

  test("maps the init snapshot to the registered repos and drops task data", () => {
    const onEvent = mock();
    createHostEventsConnection({ onEvent });

    latestSource().emit("init", {
      type: "init",
      status: {
        globalCapacity: { working: 1, max: 3 },
        swimlanes: [],
        repos: [
          {
            id: "repo-1",
            name: "aop-mono",
            path: "/repos/aop-mono",
            working: 1,
            max: 3,
            tasks: [{ id: "task-1", repoId: "repo-1", status: "WORKING" }],
          },
          { id: "repo-2", name: null, path: "/repos/other", working: 0, max: 3, tasks: [] },
        ],
      },
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "init",
      data: {
        repos: [
          { id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" },
          { id: "repo-2", name: null, path: "/repos/other" },
        ],
      },
    });
  });

  test("maps chat-unread to the four fields the unread store consumes", () => {
    const onEvent = mock();
    createHostEventsConnection({ onEvent });

    latestSource().emit("chat-unread", {
      type: "chat-unread",
      sessionId: "session-1",
      title: "Fix flaky test",
      snippet: "Done — pushed a fix",
      kind: "assistant-final",
      extraServerField: "ignored",
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: "chat-unread",
      data: {
        sessionId: "session-1",
        title: "Fix flaky test",
        snippet: "Done — pushed a fix",
        kind: "assistant-final",
      },
    });
  });

  test("maps repo-removed and data-reset", () => {
    const onEvent = mock();
    createHostEventsConnection({ onEvent });

    latestSource().emit("repo-removed", { type: "repo-removed", repoId: "repo-9" });
    latestSource().emit("data-reset", { type: "data-reset" });

    expect(onEvent.mock.calls.map((call) => call[0])).toEqual([
      { type: "repo-removed", data: { repoId: "repo-9" } },
      { type: "data-reset", data: {} },
    ]);
  });

  test("does not deliver task events the dashboard no longer models", () => {
    const onEvent = mock();
    createHostEventsConnection({ onEvent });

    latestSource().emit("task-created", { type: "task-created", task: { id: "task-1" } });
    latestSource().emit("task-status-changed", { type: "task-status-changed", taskId: "task-1" });
    latestSource().emit("heartbeat", { type: "heartbeat" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  test("reports unparseable payloads through onError without emitting an event", () => {
    const onEvent = mock();
    const onError = mock();
    createHostEventsConnection({ onEvent, onError });

    latestSource().emit("init", "{not json");

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Failed to parse SSE event");
  });

  test("reports connect, disconnect, and reconnects with exponential backoff", () => {
    const onConnect = mock();
    const onDisconnect = mock();
    createHostEventsConnection({ onEvent: mock(), onConnect, onDisconnect });

    latestSource().onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(1);

    const first = latestSource();
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(timers.map((timer) => timer.delay)).toEqual([1000]);
    expect(MockEventSource.instances).toHaveLength(1);

    timers[0]?.callback();
    expect(MockEventSource.instances).toHaveLength(2);

    // A failed reconnect backs off further.
    latestSource().onerror?.();
    expect(timers.map((timer) => timer.delay)).toEqual([1000, 2000]);

    // A successful reconnect resets the backoff.
    timers[1]?.callback();
    latestSource().onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(2);
    latestSource().onerror?.();
    expect(timers.map((timer) => timer.delay)).toEqual([1000, 2000, 1000]);
  });

  test("caps the reconnect delay at 30 seconds", () => {
    createHostEventsConnection({ onEvent: mock() });

    for (let attempt = 0; attempt < 8; attempt++) {
      latestSource().onerror?.();
      timers.at(-1)?.callback();
    }

    expect(Math.max(...timers.map((timer) => timer.delay))).toBe(30000);
  });

  test("close() shuts the stream, cancels a pending retry, and stops reconnecting", () => {
    const connection = createHostEventsConnection({ onEvent: mock() });

    latestSource().onerror?.();
    const pending = timers[0];
    expect(pending?.cleared).toBe(false);

    connection.close();
    expect(pending?.cleared).toBe(true);

    // Even if the stale timer fires, no new stream is opened.
    pending?.callback();
    expect(MockEventSource.instances).toHaveLength(1);
  });

  test("close() closes the live stream and suppresses the reconnect on a late error", () => {
    const connection = createHostEventsConnection({ onEvent: mock() });
    const source = latestSource();

    connection.close();
    expect(source.closed).toBe(true);

    source.onerror?.();
    expect(timers).toHaveLength(0);
  });
});
