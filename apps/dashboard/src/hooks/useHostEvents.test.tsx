import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import type * as HostEventsHook from "./useHostEvents";

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
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const { act, cleanup, renderHook } = await import("@testing-library/react");
// Query-string instance: App.test.tsx registers a process-wide mock.module for the hook
// path, which would otherwise replace the module under test.
const { useHostEvents } = (await import(
  "./useHostEvents" + "?host-events-hook-test"
)) as typeof HostEventsHook;
const { getChatUnreadSnapshot, resetChatUnreadStore } = await import("./use-chat-unread");

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

const statusResponse = (repos: Array<{ id: string; name: string | null; path: string }>) =>
  new Response(
    JSON.stringify({
      globalCapacity: { working: 0, max: 3 },
      swimlanes: [],
      repos: repos.map((repo) => ({ ...repo, working: 0, max: 3, tasks: [] })),
    }),
    { status: 200 },
  );

const latestSource = (): MockEventSource => {
  const source = MockEventSource.instances.at(-1);
  if (!source) throw new Error("Expected an EventSource instance");
  return source;
};

const repoA = { id: "repo-a", name: "alpha", path: "/repos/alpha" };
const repoB = { id: "repo-b", name: null, path: "/repos/beta" };

let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  MockEventSource.instances = [];
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  fetchMock = mock(() => Promise.resolve(statusResponse([])));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  resetChatUnreadStore();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  resetChatUnreadStore();
});

describe("useHostEvents", () => {
  test("starts empty and disconnected, then tracks the stream connection", () => {
    const { result } = renderHook(() => useHostEvents());

    expect(result.current.repos).toEqual([]);
    expect(result.current.connected).toBe(false);
    expect(latestSource().url).toBe("/api/events");

    act(() => latestSource().onopen?.());
    expect(result.current.connected).toBe(true);

    act(() => latestSource().onerror?.());
    expect(result.current.connected).toBe(false);
  });

  test("init snapshot sets the registered repos", () => {
    const { result } = renderHook(() => useHostEvents());

    act(() =>
      latestSource().emit("init", {
        type: "init",
        status: {
          globalCapacity: { working: 0, max: 3 },
          swimlanes: [],
          repos: [
            { ...repoA, working: 0, max: 3, tasks: [] },
            { ...repoB, working: 0, max: 3, tasks: [] },
          ],
        },
      }),
    );

    expect(result.current.repos).toEqual([repoA, repoB]);
  });

  test("repo-removed and data-reset re-read the repos from /status", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(statusResponse([repoB])));
    const { result } = renderHook(() => useHostEvents());

    await act(async () => {
      latestSource().emit("repo-removed", { type: "repo-removed", repoId: "repo-a" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/status");
    expect(result.current.repos).toEqual([repoB]);

    fetchMock.mockImplementation(() => Promise.resolve(statusResponse([])));
    await act(async () => {
      latestSource().emit("data-reset", { type: "data-reset" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.repos).toEqual([]);
  });

  test("a failed refresh after repo-removed keeps the current repos and does not throw", async () => {
    const { result } = renderHook(() => useHostEvents());
    act(() =>
      latestSource().emit("init", {
        type: "init",
        status: {
          globalCapacity: { working: 0, max: 3 },
          swimlanes: [],
          repos: [{ ...repoA, working: 0, max: 3, tasks: [] }],
        },
      }),
    );

    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    await act(async () => {
      latestSource().emit("repo-removed", { type: "repo-removed", repoId: "repo-x" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.repos).toEqual([repoA]);
  });

  test("the newest refresh wins when responses arrive out of order", async () => {
    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    const { result } = renderHook(() => useHostEvents());

    let older: Promise<void> = Promise.resolve();
    let newer: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.refresh();
      newer = result.current.refresh();
    });
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[1]?.(statusResponse([repoB]));
      await newer;
    });
    expect(result.current.repos).toEqual([repoB]);

    await act(async () => {
      pending[0]?.(statusResponse([repoA]));
      await older;
    });
    expect(result.current.repos).toEqual([repoB]);
  });

  test("forwards chat-unread pushes to the unread store", () => {
    renderHook(() => useHostEvents());

    act(() =>
      latestSource().emit("chat-unread", {
        type: "chat-unread",
        sessionId: "session-1",
        title: "Fix tests",
        snippet: "All green",
        kind: "assistant-final",
      }),
    );

    expect(getChatUnreadSnapshot().items).toEqual([
      {
        sessionId: "session-1",
        title: "Fix tests",
        snippet: "All green",
        kind: "assistant-final",
        count: 1,
      },
    ]);
  });

  test("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useHostEvents());
    const source = latestSource();

    unmount();

    expect(source.closed).toBe(true);
  });
});
