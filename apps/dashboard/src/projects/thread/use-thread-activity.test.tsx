import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { ThreadActivity, ThreadTurnActivity } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { deferred, delta, messageEntry, reply } from "../chat/test-utils";
import { makeThread } from "../test-utils";
import { hostError, json, mockHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, renderHook, screen, waitFor } = await import("@testing-library/react");
const { flush, setupPane } = await import("./pane-test-harness");
const { useThreadActivity } = await import("./use-thread-activity");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  window.localStorage.clear();
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
  jest.useRealTimers();
});

const turn = (
  messageId: string,
  label: string,
  overrides: Partial<ThreadTurnActivity> = {},
): ThreadTurnActivity => ({
  messageId,
  running: false,
  narration: "",
  groups: [
    { id: `g_${messageId}`, rows: [{ id: `r_${messageId}`, label, detail: null, status: "done" }] },
  ],
  ...overrides,
});

const activityRequests = (threadId = "thr_1") =>
  host.to(`/api/threads/${threadId}/activity`, "GET");

describe("useThreadActivity", () => {
  const mount = (status: "working" | "idle", replies = 0) =>
    renderHook(
      (props: { status: "working" | "idle"; replies: number; id?: string }) =>
        useThreadActivity({ id: props.id ?? "thr_1", status: props.status }, props.replies),
      { initialProps: { status, replies } },
    );

  test("reads the turns when the thread opens: finished ones by the reply they wrote, the running one apart", async () => {
    host.respondWith(() =>
      json({
        turns: [
          turn("m_a", "Bash"),
          turn("m_b", "Read"),
          turn("m_live", "Edit", { running: true }),
        ],
      }),
    );

    const { result } = mount("idle");
    await act(async () => {});

    expect([...result.current.finished.keys()]).toEqual(["m_a", "m_b"]);
    expect(result.current.finished.get("m_a")?.groups[0]?.rows[0]?.label).toBe("Bash");
    expect(result.current.running?.messageId).toBe("m_live");
    expect(activityRequests()).toHaveLength(1);
  });

  test("has nothing before the host answers, and when it has nothing to say", async () => {
    host.respondWith(() => json({ turns: [] } satisfies ThreadActivity));

    const { result } = mount("idle");
    expect(result.current.finished.size).toBe(0);
    expect(result.current.running).toBeUndefined();
    await act(async () => {});

    expect(result.current.finished.size).toBe(0);
    expect(result.current.running).toBeUndefined();
  });

  test("reads again when a reply arrives", async () => {
    host.respondWith(() => json({ turns: [] }));
    const { rerender } = mount("idle", 0);
    await act(async () => {});
    expect(activityRequests()).toHaveLength(1);

    rerender({ status: "idle", replies: 1 });
    await act(async () => {});

    expect(activityRequests()).toHaveLength(2);
  });

  test("reads again when the thread changes status", async () => {
    host.respondWith(() => json({ turns: [] }));
    const { rerender } = mount("idle");
    await act(async () => {});

    rerender({ status: "working", replies: 0 });
    await act(async () => {});

    expect(activityRequests()).toHaveLength(2);
  });

  test("does not read again when nothing it depends on changed", async () => {
    host.respondWith(() => json({ turns: [] }));
    const { rerender } = mount("idle", 2);
    await act(async () => {});

    rerender({ status: "idle", replies: 2 });
    await act(async () => {});

    expect(activityRequests()).toHaveLength(1);
  });

  test("a host that cannot answer leaves it empty, without an error", async () => {
    host.respondWith(() => hostError(500, "UNKNOWN", "boom"));

    const { result } = mount("working");
    await act(async () => {});

    expect(result.current.finished.size).toBe(0);
    expect(result.current.running).toBeUndefined();
  });

  test("keeps the last answer when a later read fails", async () => {
    host.respondWith(() => json({ turns: [turn("m_a", "Bash")] }));
    const { result, rerender } = mount("idle", 0);
    await act(async () => {});

    host.respondWith(() => hostError(500, "UNKNOWN", "boom"));
    rerender({ status: "idle", replies: 1 });
    await act(async () => {});

    expect(activityRequests()).toHaveLength(2);
    expect([...result.current.finished.keys()]).toEqual(["m_a"]);
  });

  test("an answer that arrives after the thread changed is not shown for the new thread", async () => {
    const slow = deferred<Response>();
    host.respondWith((request) =>
      request.url.includes("/thr_1/")
        ? slow.promise
        : Promise.resolve(json({ turns: [turn("m_two", "Read")] })),
    );
    const { result, rerender } = renderHook(
      (props: { id: string }) => useThreadActivity({ id: props.id, status: "idle" }, 0),
      { initialProps: { id: "thr_1" } },
    );

    rerender({ id: "thr_2" });
    await act(async () => {});
    await act(async () => slow.resolve(json({ turns: [turn("m_one", "Bash")] })));
    await act(async () => {});

    expect([...result.current.finished.keys()]).toEqual(["m_two"]);
  });

  describe("while a turn runs", () => {
    const advance = async (ms: number) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
      // The read the timer started answers on later ticks.
      for (let tick = 0; tick < 5; tick += 1) await act(async () => {});
    };

    test("reads every couple of seconds, since the running turn's calls are not on the stream", async () => {
      jest.useFakeTimers();
      host.respondWith(() => json({ turns: [] }));
      mount("working");
      await advance(0);
      expect(activityRequests()).toHaveLength(1);

      await advance(2_500);
      expect(activityRequests()).toHaveLength(2);

      await advance(2_500);
      await advance(2_500);
      expect(activityRequests()).toHaveLength(4);
    });

    test("shows the running turn's newest calls as they are read", async () => {
      jest.useFakeTimers();
      host.respondWith(() => json({ turns: [turn("m_live", "Read", { running: true })] }));
      const { result } = mount("working");
      await advance(0);
      expect(result.current.running?.groups[0]?.rows[0]?.label).toBe("Read");

      host.respondWith(() => json({ turns: [turn("m_live", "Bash", { running: true })] }));
      await advance(2_500);

      expect(result.current.running?.groups[0]?.rows[0]?.label).toBe("Bash");
    });

    test("stops reading once the thread stops working", async () => {
      jest.useFakeTimers();
      host.respondWith(() => json({ turns: [] }));
      const { rerender } = mount("working");
      await advance(0);
      await advance(2_500);
      expect(activityRequests()).toHaveLength(2);

      rerender({ status: "idle", replies: 1 });
      await advance(0);
      const afterStopping = activityRequests().length;
      await advance(30_000);

      expect(activityRequests()).toHaveLength(afterStopping);
    });

    test("an idle thread is not polled at all", async () => {
      jest.useFakeTimers();
      host.respondWith(() => json({ turns: [] }));
      mount("idle");
      await advance(0);

      await advance(30_000);

      expect(activityRequests()).toHaveLength(1);
    });

    test("stops when the pane closes", async () => {
      jest.useFakeTimers();
      host.respondWith(() => json({ turns: [] }));
      const { unmount } = mount("working");
      await advance(0);

      unmount();
      await advance(30_000);

      expect(activityRequests()).toHaveLength(1);
    });
  });
});

describe("in the transcript", () => {
  const inThread = { threadId: "thr_1" } as const;
  const said = (id: string, at: number, text: string) =>
    reply(id, at, [{ type: "text", text }], inThread);
  const logs = () => screen.getAllByTestId("work-log");

  test("a finished turn's calls sit folded above the reply they wrote, and no other", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle" }),
      messages: [said("m_a", 1, "First answer."), said("m_b", 2, "Second answer.")],
      answers: {
        "GET /api/threads/thr_1/activity": () =>
          json({
            turns: [
              turn("m_b", "Bash", {
                groups: [
                  {
                    id: "g",
                    rows: [
                      { id: "r1", label: "Bash", detail: "npm test", status: "done" },
                      { id: "r2", label: "Read", detail: null, status: "done" },
                    ],
                  },
                ],
              }),
            ],
          }),
      },
    });

    expect(logs()).toHaveLength(1);
    const [first, second] = screen.getAllByTestId("assistant-message");
    expect(first?.querySelector("[data-testid='work-log']")).toBeNull();
    expect(second?.querySelector("[data-testid='work-log']")).toBe(logs()[0] ?? null);
    expect(logs()[0]?.getAttribute("data-turn-id")).toBe("m_b");
    expect(screen.getByTestId("work-log-summary").textContent).toBe("2 tool calls");
    // The calls come before the words of the reply they belong to.
    const log = logs()[0] as HTMLElement;
    const words = screen.getByText("Second answer.");
    expect(log.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Folded until asked for.
    expect(screen.queryAllByTestId("work-log-row")).toHaveLength(0);
  });

  test("the turn being written shows its calls in the working row", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [said("m_a", 1, "Started.")],
      answers: {
        "GET /api/threads/thr_1/activity": () =>
          json({
            turns: [
              turn("m_live", "Bash", {
                running: true,
                groups: [
                  {
                    id: "g",
                    rows: [
                      { id: "r1", label: "Read", detail: null, status: "done" },
                      { id: "r2", label: "Bash", detail: "npm test", status: "running" },
                    ],
                  },
                ],
              }),
            ],
          }),
      },
    });

    const working = screen.getByTestId("thread-activity");
    const log = working.querySelector("[data-testid='work-log']");
    expect(log?.getAttribute("data-running")).toBe("true");
    expect(log?.textContent).toContain("2 tool calls · Bash");
    // It is not also drawn above a reply, since the reply does not exist yet.
    expect(
      screen.getAllByTestId("assistant-message")[0]?.querySelector("[data-testid='work-log']"),
    ).toBeNull();
  });

  test("a reply that arrives brings its calls with it", async () => {
    let turns: ThreadTurnActivity[] = [turn("m_live", "Bash", { running: true })];
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [said("m_a", 1, "Started.")],
      answers: { "GET /api/threads/thr_1/activity": () => json({ turns }) },
    });
    const before = activityRequests().length;
    act(() => stream.stub.emit({ kind: "delta", delta: delta("m_live", "Almost", inThread) }));

    turns = [turn("m_live", "Bash")];
    act(() =>
      stream.stub.emit({ kind: "entry", entry: messageEntry(1, said("m_live", 5, "All done.")) }),
    );
    await flush();

    expect(activityRequests()).toHaveLength(before + 1);
    // The host also says the turn is over; the working row goes and the reply keeps its calls.
    await stream.setThread(makeThread({ id: "thr_1", status: "idle" }));
    await waitFor(() => expect(logs()).toHaveLength(1));
    expect(logs()[0]?.getAttribute("data-running")).toBe("false");
    expect(screen.queryAllByTestId("thread-activity").length).toBe(0);
    const finished = screen.getAllByTestId("assistant-message").at(-1);
    expect(finished?.querySelector("[data-testid='work-log']")).toBe(logs()[0] ?? null);
  });

  test("a host that cannot say what the agent did leaves the transcript as text", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle" }),
      messages: [said("m_a", 1, "First answer.")],
      answers: { "GET /api/threads/thr_1/activity": () => hostError(500, "UNKNOWN", "boom") },
    });

    expect(screen.getByText("First answer.")).toBeTruthy();
    expect(screen.queryByTestId("work-log")).toBeNull();
    expect(screen.queryByTestId("chat-error")).toBeNull();
  });
});
