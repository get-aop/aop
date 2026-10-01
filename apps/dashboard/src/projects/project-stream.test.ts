import { beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { createFakeStreamDeps, makeThread, threadEntry } from "./test-utils";

setupDashboardDom();

const { connectProjectStream, projectStreamUrl } = await import("./project-stream");
const { setHostConfig } = await import("../api/host");

const handlers = () => ({
  onState: mock((_state: string) => {}),
  onEntry: mock((_entry: unknown) => {}),
  onDelta: mock((_delta: unknown) => {}),
  onLive: mock((_snapshot: unknown) => {}),
  onResync: mock((_resync: unknown) => {}),
  onRejected: mock(() => {}),
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("projectStreamUrl", () => {
  test("names the project's stream, with a cursor only when there is one", () => {
    expect(projectStreamUrl("prj 1", null)).toBe("/api/projects/prj%201/stream");
    expect(projectStreamUrl("prj_1", 41)).toBe("/api/projects/prj_1/stream?after=41");
  });
});

describe("connectProjectStream", () => {
  test("opens one source for the project and reports connecting, then live", () => {
    const { sources, deps } = createFakeStreamDeps();
    const on = handlers();
    connectProjectStream("prj_1", on, deps);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("/api/projects/prj_1/stream");
    expect(sources[0]?.withCredentials).toBe(false);
    expect(on.onState).toHaveBeenLastCalledWith("connecting");

    sources[0]?.open();
    expect(on.onState).toHaveBeenLastCalledWith("live");
  });

  test("a host on another origin is called with credentials", () => {
    setHostConfig({ baseUrl: "https://host.example", token: "t" });
    const { sources, deps } = createFakeStreamDeps();
    connectProjectStream("prj_1", handlers(), deps);

    expect(sources[0]?.url).toBe("https://host.example/api/projects/prj_1/stream");
    expect(sources[0]?.withCredentials).toBe(true);
  });

  test("delivers valid entries, deltas and resyncs, and a heartbeat proves the connection is live", () => {
    const { sources, deps } = createFakeStreamDeps();
    const on = handlers();
    connectProjectStream("prj_1", on, deps);
    const source = sources[0];

    const entry = threadEntry(5, makeThread());
    source?.emit("entry", entry, "5");
    source?.emit("delta", {
      projectId: "prj_1",
      threadId: null,
      messageId: "m1",
      ops: [{ op: "start", index: 0, part: { type: "text", text: "Hel" } }],
    });
    source?.emit("resync", { cursor: 9, reason: "start" }, "9");
    source?.emit("live", { turns: [] });
    source?.emit("heartbeat", {});

    expect(on.onEntry).toHaveBeenCalledWith(entry);
    expect(on.onDelta).toHaveBeenCalledTimes(1);
    expect(on.onLive).toHaveBeenCalledWith({ turns: [] });
    expect(on.onResync).toHaveBeenCalledWith({ cursor: 9, reason: "start" });
    expect(on.onState).toHaveBeenLastCalledWith("live");
  });

  test("an entry this build cannot read becomes a resync instead of a silent gap", () => {
    const { sources, deps } = createFakeStreamDeps();
    const on = handlers();
    connectProjectStream("prj_1", on, deps);

    sources[0]?.emit("entry", { id: 3, type: "thread.upserted", payload: { nonsense: true } }, "3");
    sources[0]?.emitRaw("entry", "not json at all");

    expect(on.onEntry).not.toHaveBeenCalled();
    expect(on.onResync).toHaveBeenCalledTimes(2);
    expect(on.onResync).toHaveBeenCalledWith({ cursor: 0, reason: "unreadable" });
  });

  test("while the browser retries by itself it only reports reconnecting", () => {
    const { sources, deps, timers } = createFakeStreamDeps();
    const on = handlers();
    connectProjectStream("prj_1", on, deps);

    sources[0]?.open();
    sources[0]?.drop();

    expect(on.onState).toHaveBeenLastCalledWith("reconnecting");
    expect(on.onRejected).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  test("when the browser gives up, a fresh source resumes after the newest entry seen", () => {
    const { sources, deps, timers, fireTimers } = createFakeStreamDeps();
    const on = handlers();
    connectProjectStream("prj_1", on, deps);

    sources[0]?.open();
    sources[0]?.emit("entry", threadEntry(7, makeThread()), "7");
    sources[0]?.emit("entry", threadEntry(8, makeThread()), "8");
    sources[0]?.reject();

    expect(on.onRejected).toHaveBeenCalledTimes(1);
    expect(sources[0]?.closed).toBe(true);
    expect(timers[0]?.delayMs).toBe(1_000);

    fireTimers();
    expect(sources).toHaveLength(2);
    expect(sources[1]?.url).toBe("/api/projects/prj_1/stream?after=8");
    expect(on.onState).toHaveBeenLastCalledWith("reconnecting");

    sources[1]?.open();
    expect(on.onState).toHaveBeenLastCalledWith("live");
  });

  test("retries back off while the host stays down, and start over once it answers", () => {
    const { sources, deps, timers, fireTimers } = createFakeStreamDeps();
    connectProjectStream("prj_1", handlers(), deps);

    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      sources.at(-1)?.reject();
      delays.push(timers.at(-1)?.delayMs ?? -1);
      fireTimers();
    }
    expect(delays).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000, 30_000]);

    sources.at(-1)?.open();
    sources.at(-1)?.reject();
    expect(timers.at(-1)?.delayMs).toBe(1_000);
  });

  test("a resync moves the cursor to the log's, even backwards after a restored database", () => {
    const { sources, deps, fireTimers } = createFakeStreamDeps();
    connectProjectStream("prj_1", handlers(), deps);

    sources[0]?.emit("entry", threadEntry(90, makeThread()), "90");
    sources[0]?.emit("resync", { cursor: 12, reason: "ahead" }, "12");
    sources[0]?.reject();
    fireTimers();

    expect(sources[1]?.url).toBe("/api/projects/prj_1/stream?after=12");
  });

  test("close stops the source and any retry that was waiting", () => {
    const { sources, deps, fireTimers } = createFakeStreamDeps();
    const on = handlers();
    const stream = connectProjectStream("prj_1", on, deps);

    sources[0]?.reject();
    stream.close();
    fireTimers();
    expect(sources).toHaveLength(1);

    // A source that was already closed must not report to the page any more.
    const reported = on.onState.mock.calls.length;
    sources[0]?.drop();
    expect(on.onState.mock.calls.length).toBe(reported);
  });
});
