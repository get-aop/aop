import { describe, expect, mock, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";
import {
  createFakeStreamDeps,
  type FakeEventSource,
  makeProject,
  makeThread,
  projectEntry,
  threadEntry,
} from "./test-utils";

setupDashboardDom();

const { ApiError } = await import("../api/request");
const { createLiveProjects, IDLE_SNAPSHOT_EVERY, POLL_INTERVAL_MS, SNAPSHOT_RETRY_MS } =
  await import("./live-projects");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A live-projects instance wired to a scripted API and hand-driven event sources. */
const harness = (projects: Project[], threads: Record<string, Thread[]> = {}) => {
  const stream = createFakeStreamDeps();
  const scheduled: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const api = {
    listProjects: mock(async () => projects),
    getProject: mock(async (id: string) => {
      const found = projects.find((project) => project.id === id);
      if (!found) throw new ApiError(404, "NOT_FOUND", "Project not found");
      return found;
    }),
    listThreads: mock(async (id: string) => threads[id] ?? []),
  };
  const live = createLiveProjects({
    api,
    stream: stream.deps,
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false };
      scheduled.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const sourceOf = (projectId: string): FakeEventSource => {
    const found = stream.sources.findLast((source) => source.url.includes(`/${projectId}/stream`));
    if (!found) throw new Error(`no stream for ${projectId}`);
    return found;
  };
  const openStreams = () => stream.sources.filter((source) => !source.closed).map((s) => s.url);
  /** Runs the poll timer that is pending. */
  const poll = async () => {
    const timer = scheduled.findLast((t) => t.delayMs === POLL_INTERVAL_MS && !t.cancelled);
    timer?.run();
    await flush();
  };
  /** Poll timers that are armed and not cancelled: more than one means two chains are running. */
  const pendingPolls = () =>
    scheduled.filter((t) => t.delayMs === POLL_INTERVAL_MS && !t.cancelled).length;
  const pendingRetries = () =>
    scheduled.filter((t) => t.delayMs === SNAPSHOT_RETRY_MS && !t.cancelled);
  /** Runs the snapshot retry that is pending, as its timer would, and lets it settle. */
  const retry = async () => {
    const [timer] = pendingRetries();
    if (!timer) throw new Error("no snapshot retry is pending");
    scheduled.splice(scheduled.indexOf(timer), 1);
    timer.run();
    await flush();
  };
  return { live, api, sourceOf, openStreams, poll, pendingPolls, pendingRetries, retry, stream };
};

const started = async (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  h.live.start();
  await flush();
  return h;
};

describe("startup", () => {
  test("loads the list, opens a stream per project, and a start resync loads the threads", async () => {
    const a = makeProject({ id: "a" });
    const h = await started([a], { a: [makeThread({ id: "t1", projectId: "a" })] });

    expect(h.live.getState().phase).toBe("ready");
    expect(h.live.getState().byId.a?.threadsLoaded).toBe(false);
    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);

    h.sourceOf("a").open();
    h.sourceOf("a").emit("resync", { cursor: 4, reason: "start" }, "4");
    await flush();

    expect(h.live.getState().byId.a?.threadsLoaded).toBe(true);
    expect(h.live.getState().byId.a?.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(h.live.getState().byId.a?.connection).toBe("live");
  });

  test("a project list that answers after the threads loaded keeps them loaded", async () => {
    const a = makeProject({ id: "a" });
    const h = await started([a], { a: [makeThread({ id: "t1", projectId: "a" })] });
    // A busy browser holds the poll's list request back until after the snapshot has landed.
    let releaseList: (projects: Project[]) => void = () => {};
    h.api.listProjects.mockImplementationOnce(
      () => new Promise<Project[]>((resolve) => (releaseList = resolve)),
    );
    await h.poll();

    h.sourceOf("a").emit("resync", { cursor: 4, reason: "start" }, "4");
    await flush();
    expect(h.live.getState().byId.a?.threadsLoaded).toBe(true);

    releaseList([a]);
    await flush();

    expect(h.live.getState().byId.a?.threadsLoaded).toBe(true);
    expect(h.live.getState().byId.a?.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  test("an unreachable host is an error to show, not a silent empty list", async () => {
    const h = harness([]);
    h.api.listProjects.mockImplementationOnce(async () => {
      throw new Error("Failed to fetch");
    });
    h.live.start();
    await flush();

    expect(h.live.getState()).toMatchObject({ phase: "error", error: "Failed to fetch" });
  });

  test("a start right after a stop (React's development remount) keeps one poll chain and reopens the streams", async () => {
    const h = harness([makeProject({ id: "a" })]);
    h.live.start();
    h.live.stop();
    h.live.start();
    await flush();
    await flush();

    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);
    expect(h.pendingPolls()).toBe(1);

    h.live.stop();
    h.live.start();
    // The projects are already known: the streams come back without waiting for the list.
    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);
    await flush();
    expect(h.pendingPolls()).toBe(1);
  });

  test("stop closes every stream and ignores what arrives afterwards", async () => {
    const h = await started([makeProject({ id: "a" })]);
    h.live.stop();

    expect(h.openStreams()).toEqual([]);
  });
});

describe("live entries", () => {
  test("a thread entry updates the card in place; the same entry again changes nothing", async () => {
    const h = await started([makeProject({ id: "a" })]);
    const source = h.sourceOf("a");
    source.emit("resync", { cursor: 1, reason: "start" }, "1");
    await flush();

    const listener = mock(() => {});
    h.live.subscribe(listener);
    const entry = threadEntry(2, makeThread({ id: "t1", projectId: "a", title: "First" }));
    source.emit("entry", entry, "2");
    const afterOnce = h.live.getState();
    source.emit("entry", entry, "2");

    expect(afterOnce.byId.a?.threads.map((t) => t.title)).toEqual(["First"]);
    expect(h.live.getState().byId.a?.threads).toEqual(afterOnce.byId.a?.threads ?? []);
    expect(listener).toHaveBeenCalled();
  });

  test("a project.removed entry drops the project and closes its stream", async () => {
    const h = await started([makeProject({ id: "a" }), makeProject({ id: "b" })]);
    h.sourceOf("a").emit(
      "entry",
      { id: 9, projectId: "a", type: "project.removed", payload: {} },
      "9",
    );

    expect(Object.keys(h.live.getState().byId)).toEqual(["b"]);
    expect(h.openStreams()).toEqual(["/api/projects/b/stream"]);
  });

  test("listeners of one project's events hear entries, live text and resyncs, and only its own", async () => {
    const h = await started([makeProject({ id: "a" }), makeProject({ id: "b" })]);
    const heardA = mock((_event: { kind: string }) => {});
    const heardB = mock((_event: { kind: string }) => {});
    const stopA = h.live.subscribeEvents("a", heardA);
    h.live.subscribeEvents("b", heardB);

    h.sourceOf("a").emit("entry", threadEntry(2, makeThread({ projectId: "a" })), "2");
    h.sourceOf("a").emit("delta", {
      projectId: "a",
      threadId: null,
      messageId: "m1",
      text: "Hi",
      replace: false,
    });
    h.sourceOf("a").emit("resync", { cursor: 2, reason: "trimmed" }, "2");
    await flush();

    expect(heardA.mock.calls.map(([event]) => event.kind)).toEqual(["entry", "delta", "resync"]);
    expect(heardB).not.toHaveBeenCalled();

    stopA();
    h.sourceOf("a").emit("entry", threadEntry(3, makeThread({ projectId: "a" })), "3");
    expect(heardA).toHaveBeenCalledTimes(3);
  });
});

describe("resync", () => {
  test("an entry that arrives while the snapshot is in flight is applied after it, not rolled back", async () => {
    const a = makeProject({ id: "a" });
    const h = harness([a]);
    let release: (threads: Thread[]) => void = () => {};
    h.api.listThreads.mockImplementation(
      () => new Promise<Thread[]>((resolve) => (release = resolve)),
    );
    h.live.start();
    await flush();

    const source = h.sourceOf("a");
    source.emit("resync", { cursor: 1, reason: "start" }, "1");
    await flush();
    // The snapshot was read before this thread changed; the entry says it is now blocked.
    source.emit(
      "entry",
      threadEntry(2, makeThread({ id: "t1", projectId: "a", status: "waiting-on-you" })),
      "2",
    );
    release([makeThread({ id: "t1", projectId: "a", status: "working" })]);
    await flush();

    expect(h.live.getState().byId.a?.threads.map((t) => t.status)).toEqual(["waiting-on-you"]);
  });

  test("a resync replaces the state wholesale: a thread deleted meanwhile disappears", async () => {
    const a = makeProject({ id: "a" });
    const threads = { a: [makeThread({ id: "keep", projectId: "a" })] };
    const h = await started([a], threads);
    h.sourceOf("a").emit("resync", { cursor: 1, reason: "start" }, "1");
    await flush();
    h.sourceOf("a").emit("entry", threadEntry(2, makeThread({ id: "stale", projectId: "a" })), "2");
    expect(h.live.getState().byId.a?.threads).toHaveLength(2);

    h.sourceOf("a").emit("resync", { cursor: 5, reason: "trimmed" }, "5");
    await flush();

    expect(h.live.getState().byId.a?.threads.map((t) => t.id)).toEqual(["keep"]);
  });

  test("a failed snapshot is retried, and the entries that waited are still applied", async () => {
    const a = makeProject({ id: "a" });
    const h = harness([a]);
    h.api.listThreads.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    h.live.start();
    await flush();
    const source = h.sourceOf("a");
    source.emit("resync", { cursor: 1, reason: "start" }, "1");
    source.emit("entry", threadEntry(2, makeThread({ id: "t1", projectId: "a" })), "2");
    await flush();

    expect(h.live.getState().byId.a?.threadsLoaded).toBe(false);
    expect(h.live.getState().byId.a?.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(h.api.listThreads).toHaveBeenCalledTimes(1);
  });
});

describe("a fetch of the threads that fails", () => {
  // A project whose threads the host cannot list (a 500, as a row it cannot read gives), until `heal`.
  const failing = async () => {
    const h = harness([makeProject({ id: "a" })]);
    h.api.listThreads.mockImplementation(async () => {
      throw new ApiError(500, "UNKNOWN", "Request failed (500)");
    });
    h.live.start();
    await flush();
    h.sourceOf("a").emit("resync", { cursor: 1, reason: "start" }, "1");
    await flush();
    const heal = () =>
      h.api.listThreads.mockImplementation(async () => [makeThread({ id: "t1", projectId: "a" })]);
    return { h, heal };
  };

  test("says why on the project, instead of loading forever", async () => {
    const { h } = await failing();

    expect(h.live.getState().byId.a).toMatchObject({
      threadsLoaded: false,
      threadsError: "Request failed (500)",
    });
  });

  test("keeps being retried on its own, and the error clears once the host answers", async () => {
    const { h, heal } = await failing();
    await h.retry();

    expect(h.api.listThreads).toHaveBeenCalledTimes(2);
    expect(h.live.getState().byId.a?.threadsError).toBe("Request failed (500)");
    expect(h.pendingRetries()).toHaveLength(1);

    heal();
    await h.retry();

    expect(h.live.getState().byId.a).toMatchObject({ threadsLoaded: true, threadsError: null });
    expect(h.live.getState().byId.a?.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(h.pendingRetries()).toHaveLength(0);
  });

  test("refetch tries again at once and leaves one retry waiting while it still fails", async () => {
    const { h, heal } = await failing();
    await h.live.refetch("a");

    expect(h.api.listThreads).toHaveBeenCalledTimes(2);
    expect(h.live.getState().byId.a?.threadsError).toBe("Request failed (500)");
    expect(h.pendingRetries()).toHaveLength(1);

    heal();
    await h.live.refetch("a");

    expect(h.live.getState().byId.a).toMatchObject({ threadsLoaded: true, threadsError: null });
  });

  test("a project the host no longer has is dropped, not shown as failing", async () => {
    const h = await started([makeProject({ id: "a" })]);
    h.api.listThreads.mockImplementation(async () => {
      throw new ApiError(404, "NOT_FOUND", "Project not found");
    });
    h.sourceOf("a").emit("resync", { cursor: 1, reason: "start" }, "1");
    await flush();

    expect(h.live.getState().byId.a).toBeUndefined();
  });
});

describe("the host restarting", () => {
  test("a stream the browser gave up on refetches the project; a deleted project goes away", async () => {
    const a = makeProject({ id: "a" });
    const projects = [a, makeProject({ id: "b" })];
    const h = await started(projects);
    projects.pop();

    h.sourceOf("b").reject();
    await flush();

    expect(Object.keys(h.live.getState().byId)).toEqual(["a"]);
    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);
  });

  test("a source that reconnects gives the project back its live state", async () => {
    const h = await started([makeProject({ id: "a" })]);
    h.sourceOf("a").open();
    h.sourceOf("a").drop();
    expect(h.live.getState().byId.a?.connection).toBe("reconnecting");

    h.sourceOf("a").open();
    expect(h.live.getState().byId.a?.connection).toBe("live");
  });
});

describe("the stream cap", () => {
  const six = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, index) =>
    makeProject({ id, updatedAt: `2026-09-29T1${6 - index}:00:00.000Z` }),
  );

  test("watches at most four projects, so requests keep a connection", async () => {
    const h = await started(six);

    expect(h.openStreams()).toHaveLength(4);
    expect(h.live.getState().byId.p5?.connection).toBe("idle");
  });

  test("opening a project moves a stream to it", async () => {
    const h = await started(six);
    h.live.setSelected("p6");

    expect(h.openStreams()).toContain("/api/projects/p6/stream");
    expect(h.openStreams()).toHaveLength(4);
    expect(h.live.getState().byId.p6?.connection).toBe("connecting");
  });

  test("projects without a stream are loaded at startup and refetched on the poll, so their attention stays fresh", async () => {
    const threads: Record<string, Thread[]> = {
      p5: [makeThread({ id: "t", projectId: "p5", status: "waiting-on-you" })],
    };
    const h = await started(six, threads);
    expect(h.live.getState().byId.p5?.threads.map((t) => t.status)).toEqual(["waiting-on-you"]);
    // Streamed projects wait for their stream's resync instead.
    expect(h.live.getState().byId.p1?.threadsLoaded).toBe(false);

    threads.p5 = [makeThread({ id: "t", projectId: "p5", status: "working" })];
    for (let tick = 1; tick < IDLE_SNAPSHOT_EVERY; tick += 1) await h.poll();
    // The polls in between only refetch the list.
    expect(h.live.getState().byId.p5?.threads.map((t) => t.status)).toEqual(["waiting-on-you"]);
    await h.poll();

    expect(h.live.getState().byId.p5?.threads.map((t) => t.status)).toEqual(["working"]);
    expect(h.live.getState().byId.p1?.threadsLoaded).toBe(false);
  });

  test("a project made on another client appears on the next poll and gets a stream", async () => {
    const projects = [makeProject({ id: "a" })];
    const h = await started(projects);
    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);

    projects.push(makeProject({ id: "b" }));
    await h.poll();

    expect(h.live.getState().byId.b).toBeDefined();
    expect(h.openStreams()).toContain("/api/projects/b/stream");
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("changes this client makes itself", () => {
  test("adopt shows a new project at once and opens its stream; forget removes it", async () => {
    const h = await started([]);
    h.live.adopt(makeProject({ id: "new" }));

    expect(h.live.getState().byId.new).toBeDefined();
    expect(h.openStreams()).toEqual(["/api/projects/new/stream"]);

    h.live.forget("new");
    expect(h.live.getState().byId.new).toBeUndefined();
    expect(h.openStreams()).toEqual([]);
  });

  test("archiving a project ends its stream; restoring it opens one again", async () => {
    const a = makeProject({ id: "a" });
    const h = await started([a]);

    h.live.adopt(
      makeProject({ id: "a", status: "archived", updatedAt: "2026-09-29T11:00:00.000Z" }),
    );
    expect(h.openStreams()).toEqual([]);

    h.live.adopt(makeProject({ id: "a", status: "active", updatedAt: "2026-09-29T12:00:00.000Z" }));
    expect(h.openStreams()).toEqual(["/api/projects/a/stream"]);
  });

  test("a project.upserted entry from another device renames it here", async () => {
    const h = await started([makeProject({ id: "a" })]);
    h.sourceOf("a").emit(
      "entry",
      projectEntry(
        2,
        makeProject({ id: "a", name: "Renamed", updatedAt: "2026-09-29T12:00:00.000Z" }),
      ),
      "2",
    );

    expect(h.live.getState().byId.a?.project.name).toBe("Renamed");
  });
});
