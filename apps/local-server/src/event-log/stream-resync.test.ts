import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProjectRepository } from "../project/repository.ts";
import { createEventLogRepository } from "./repository.ts";
import { MAX_REPLAY_ENTRIES } from "./stream-feed.ts";
import {
  createStreamHarness,
  projectRemoved,
  type StreamHarness,
  threadRemoved,
} from "./test-utils.ts";

describe("project event stream: removal and resync", () => {
  let h: StreamHarness;

  beforeEach(async () => {
    h = await createStreamHarness();
  });

  afterEach(async () => {
    await h.dispose();
  });

  // What a project service does: the delete and its announcement commit together.
  const removeProject = (projectId: string) =>
    h.publisher.transaction(async ({ db, append }) => {
      await createProjectRepository(db).remove(projectId);
      return append(projectRemoved(projectId));
    });

  describe("when the project is removed", () => {
    test("the removal is the last thing an open stream sends, then it ends", async () => {
      const connection = await h.connectSettled("p1");
      const before = await h.publisher.publish(threadRemoved("p1", "t1"));

      const removal = await removeProject("p1");
      await connection.ended;

      expect(connection.entries()).toEqual([before, removal]);
    });

    test("a client resuming from before the removal still learns of it, after the project is gone", async () => {
      const seen = await h.publisher.publish(threadRemoved("p1", "t1"));
      const removal = await removeProject("p1");

      const late = await h.connect("p1", `?after=${seen.id}`);
      await late.ended;

      expect(late.status).toBe(200);
      expect(late.entries()).toEqual([removal]);
    });

    test("a client that already saw the removal is told the project does not exist, so it stops retrying", async () => {
      const removal = await removeProject("p1");

      const resumed = await h.connect("p1", `?after=${removal.id}`);

      expect(resumed.status).toBe(404);
    });

    test("a client with no cursor for a deleted project, and one for a project that never existed, get 404", async () => {
      await removeProject("p1");

      expect((await h.connect("p1")).status).toBe(404);
      expect((await h.connect("never-existed", "?after=0")).status).toBe(404);
    });

    test("does not end the stream of another project", async () => {
      const other = await h.connectSettled("p2");

      await removeProject("p1");
      const next = await h.publisher.publish(threadRemoved("p2", "t1"));
      await other.waitForFrames("entry", 1);

      expect(other.entries()).toEqual([next]);
    });
  });

  describe("resync", () => {
    const appendFive = async () => {
      const publish = (n: number) => h.publisher.publish(threadRemoved("p1", `t${n}`));
      return {
        a: await publish(1),
        b: await publish(2),
        c: await publish(3),
        d: await publish(4),
        e: await publish(5),
      };
    };

    const resyncOf = (frames: { event: string; data: string }[]) =>
      frames.filter((frame) => frame.event === "resync").map((frame) => JSON.parse(frame.data));

    test("a cursor that points into trimmed entries gets a resync to the newest id, then live entries", async () => {
      const { a, e } = await appendFive();
      await createEventLogRepository(h.db).trimToNewest(2);

      const connection = await h.connect("p1", `?after=${a.id}`);
      await connection.waitForFrames("resync", 1);
      const next = await h.publisher.publish(threadRemoved("p1", "t6"));
      await connection.waitForFrames("entry", 1);

      expect(resyncOf(connection.frames)).toEqual([{ cursor: e.id, reason: "trimmed" }]);
      expect(connection.entries()).toEqual([next]);
    });

    test("a cursor at the trim floor has missed nothing and is replayed", async () => {
      const { c, d, e } = await appendFive();
      await createEventLogRepository(h.db).trimToNewest(2);

      const connection = await h.connect("p1", `?after=${c.id}`);
      await connection.waitForFrames("entry", 2);

      expect(connection.entries()).toEqual([d, e]);
      expect(resyncOf(connection.frames)).toEqual([]);
    });

    test("a cursor newer than any entry, as after a restored database, gets a resync", async () => {
      const { e } = await appendFive();

      const connection = await h.connect("p1", "?after=999999");
      await connection.waitForFrames("resync", 1);

      expect(resyncOf(connection.frames)).toEqual([{ cursor: e.id, reason: "ahead" }]);
    });

    test("an entry that can no longer be read is resynced past instead of retried forever", async () => {
      const before = await h.publisher.publish(threadRemoved("p1", "t1"));
      // Stored by an older version of the schema: no longer valid for its type.
      await h.db
        .insertInto("event_log")
        .values({ project_id: "p1", type: "thread.removed", payload: "{}" })
        .execute();
      const unreadable = await createEventLogRepository(h.db).latestId();

      const connection = await h.connect("p1", `?after=${before.id}`);
      await connection.waitForFrames("resync", 1);
      const next = await h.publisher.publish(threadRemoved("p1", "t2"));
      await connection.waitForFrames("entry", 1);

      expect(resyncOf(connection.frames)).toEqual([{ cursor: unreadable, reason: "unreadable" }]);
      expect(connection.entries()).toEqual([next]);
    });

    test("a resync leaves the client's cursor at the id it names, so a browser reconnect resumes from it", async () => {
      const { e } = await appendFive();

      const connection = await h.connect("p1");
      const resync = await connection.waitFor((frame) => frame.event === "resync");

      expect(resync.id).toBe(String(e.id));
    });

    test("a backlog over the replay limit is not replayed; one at the limit is", async () => {
      const log = createEventLogRepository(h.db);
      const stored = [];
      for (let n = 0; n <= MAX_REPLAY_ENTRIES; n++) {
        stored.push(await log.append(threadRemoved("p1", `t${n}`)));
      }
      const newest = stored.at(-1)?.id;

      const tooFar = await h.connect("p1", "?after=0");
      await tooFar.waitForFrames("resync", 1);
      const withinLimit = await h.connect("p1", `?after=${stored[0]?.id}`);
      await withinLimit.waitForFrames("entry", MAX_REPLAY_ENTRIES);

      expect(resyncOf(tooFar.frames)).toEqual([{ cursor: newest, reason: "too-large" }]);
      expect(tooFar.entries()).toEqual([]);
      expect(withinLimit.entries()).toEqual(stored.slice(1));
      expect(resyncOf(withinLimit.frames)).toEqual([]);
    });
  });
});
