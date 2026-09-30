import { describe, expect, test } from "bun:test";
import type { EventLogEntry } from "@aop/common";
import {
  applyEntry,
  applySnapshot,
  initialProjectsState,
  removeProject,
  setConnection,
  setListError,
  setProjectList,
  setThreadsError,
  upsertProject,
} from "./projects-state";
import {
  makeEntry,
  makeProject,
  makeState,
  makeThread,
  projectEntry,
  threadEntry,
} from "./test-utils";

const project = makeProject();

describe("setProjectList", () => {
  test("adds unknown projects with no threads, and drops projects the host no longer lists", () => {
    const before = makeState([makeEntry(makeProject({ id: "gone" }))]);
    const after = setProjectList(before, [project]);

    expect(Object.keys(after.byId)).toEqual(["prj_1"]);
    expect(after.byId.prj_1).toMatchObject({
      threadsLoaded: false,
      threadsError: null,
      connection: "idle",
      threads: [],
    });
    expect(after.phase).toBe("ready");
  });

  test("keeps threads and the connection of a project it already knew", () => {
    const thread = makeThread();
    const before = makeState([makeEntry(project, [thread], { connection: "live" })]);
    const after = setProjectList(before, [project]);

    expect(after.byId.prj_1?.threads).toEqual([thread]);
    expect(after.byId.prj_1?.connection).toBe("live");
  });

  test("does not roll a project back to an older copy from a slow list response", () => {
    const newer = makeProject({ name: "Renamed", updatedAt: "2026-09-29T12:00:00.000Z" });
    const before = makeState([makeEntry(newer)]);
    const after = setProjectList(before, [makeProject({ name: "Old name" })]);

    expect(after.byId.prj_1?.project.name).toBe("Renamed");
  });
});

describe("setListError", () => {
  test("is an error to show while nothing has loaded, and only an unreachable host afterwards", () => {
    const first = setListError(initialProjectsState, "boom");
    expect(first).toMatchObject({ phase: "error", error: "boom", reachable: false });

    const later = setListError(makeState([makeEntry(project)]), "boom");
    expect(later).toMatchObject({ phase: "ready", reachable: false });
    expect(later.error).toBeNull();
  });

  test("a good list, a snapshot or a stream coming back makes the host reachable again", () => {
    const down = setListError(
      makeState([makeEntry(project, [], { connection: "reconnecting" })]),
      "boom",
    );
    expect(down.reachable).toBe(false);

    expect(setProjectList(down, [project]).reachable).toBe(true);
    expect(applySnapshot(down, project, []).reachable).toBe(true);
    expect(setConnection(down, "prj_1", "live").reachable).toBe(true);
    // Still trying to reconnect: nothing has answered yet.
    expect(setConnection(down, "prj_1", "connecting").reachable).toBe(false);
  });
});

describe("applyEntry", () => {
  const start = makeState([makeEntry(project)]);

  test("thread.upserted adds a thread, then replaces it by id", () => {
    const added = applyEntry(start, threadEntry(1, makeThread({ title: "One" })));
    expect(added.byId.prj_1?.threads.map((t) => t.title)).toEqual(["One"]);

    const replaced = applyEntry(added, threadEntry(2, makeThread({ title: "One, renamed" })));
    expect(replaced.byId.prj_1?.threads.map((t) => t.title)).toEqual(["One, renamed"]);
  });

  test("replaying an entry leaves the same state", () => {
    const entry = threadEntry(1, makeThread());
    const once = applyEntry(start, entry);
    expect(applyEntry(once, entry)).toEqual(once);
  });

  test("thread.upserted for a project the page does not hold is ignored", () => {
    const stray = threadEntry(1, makeThread({ projectId: "elsewhere" }));
    expect(applyEntry(start, stray)).toBe(start);
  });

  test("thread.removed drops the thread and only that one", () => {
    const two = applyEntry(
      applyEntry(start, threadEntry(1, makeThread({ id: "a" }))),
      threadEntry(2, makeThread({ id: "b" })),
    );
    const removed: EventLogEntry = {
      id: 3,
      projectId: "prj_1",
      type: "thread.removed",
      payload: { threadId: "a" },
    };
    expect(applyEntry(two, removed).byId.prj_1?.threads.map((t) => t.id)).toEqual(["b"]);
  });

  test("project.upserted updates the project; project.removed deletes it", () => {
    const renamed = applyEntry(
      start,
      projectEntry(1, makeProject({ name: "Renamed", updatedAt: "2026-09-29T12:00:00.000Z" })),
    );
    expect(renamed.byId.prj_1?.project.name).toBe("Renamed");

    const removed = applyEntry(renamed, {
      id: 2,
      projectId: "prj_1",
      type: "project.removed",
      payload: {},
    });
    expect(removed.byId).toEqual({});
  });

  test.each(["message.created", "message.updated"] as const)(
    "%s changes nothing: the chat owns messages",
    (type) => {
      const message: EventLogEntry = {
        id: 1,
        projectId: "prj_1",
        type,
        payload: {
          message: {
            id: "m1",
            projectId: "prj_1",
            threadId: null,
            createdAt: "2026-09-29T10:00:00.000Z",
            role: "user",
            text: "hi",
          },
        },
      };
      expect(applyEntry(start, message)).toBe(start);
    },
  );
});

describe("snapshots and connection", () => {
  test("applySnapshot replaces threads wholesale and marks them loaded", () => {
    const before = makeState([
      makeEntry(project, [makeThread({ id: "stale" })], { connection: "reconnecting" }),
    ]);
    const after = applySnapshot(before, project, [makeThread({ id: "fresh" })]);

    expect(after.byId.prj_1?.threads.map((t) => t.id)).toEqual(["fresh"]);
    expect(after.byId.prj_1?.threadsLoaded).toBe(true);
    expect(after.byId.prj_1?.connection).toBe("reconnecting");
  });

  test("setThreadsError keeps why the threads did not load, without touching what is known", () => {
    const thread = makeThread();
    const before = makeState([makeEntry(project, [thread], { threadsLoaded: false })]);
    const after = setThreadsError(before, "prj_1", "Request failed (500)");

    expect(after.byId.prj_1).toMatchObject({
      threadsError: "Request failed (500)",
      threadsLoaded: false,
      threads: [thread],
    });
    // The same failure again, or one for a project the page does not know, changes nothing.
    expect(setThreadsError(after, "prj_1", "Request failed (500)")).toBe(after);
    expect(setThreadsError(after, "unknown", "Request failed (500)")).toBe(after);
  });

  test("a snapshot that succeeds clears the error; a list refetch keeps it", () => {
    const failing = setThreadsError(
      makeState([makeEntry(project, [], { threadsLoaded: false })]),
      "prj_1",
      "Request failed (500)",
    );

    expect(setProjectList(failing, [project]).byId.prj_1?.threadsError).toBe(
      "Request failed (500)",
    );
    const healed = applySnapshot(failing, project, [makeThread()]);
    expect(healed.byId.prj_1).toMatchObject({ threadsError: null, threadsLoaded: true });
  });

  test("setConnection returns the same state when nothing changes", () => {
    const state = makeState([makeEntry(project, [], { connection: "live" })]);
    expect(setConnection(state, "prj_1", "live")).toBe(state);
    expect(setConnection(state, "prj_1", "reconnecting").byId.prj_1?.connection).toBe(
      "reconnecting",
    );
    expect(setConnection(state, "unknown", "live")).toBe(state);
  });

  test("upsertProject adopts a new project; removeProject of an unknown id changes nothing", () => {
    const adopted = upsertProject(initialProjectsState, project);
    expect(adopted.byId.prj_1?.project).toEqual(project);
    expect(removeProject(adopted, "nope")).toBe(adopted);
  });
});
