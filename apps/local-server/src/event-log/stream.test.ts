import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createDatabase } from "../db/connection.ts";
import { runMigrations } from "../db/migrations.ts";
import { createEventLogRepository } from "./repository.ts";
import { openSse } from "./sse-test-client.ts";
import {
  createProjects,
  createStreamHarness,
  type StreamHarness,
  serveEventStream,
  threadRemoved,
} from "./test-utils.ts";

/** Real HTTP against a real migrated database: what a browser's EventSource would see. */
describe("project event stream", () => {
  let h: StreamHarness;

  beforeEach(async () => {
    h = await createStreamHarness();
  });

  afterEach(async () => {
    await h.dispose();
  });

  test("opens with a heartbeat, then tells a client without a cursor to resync from the newest entry", async () => {
    const newest = await h.publisher.publish(threadRemoved("p1", "t1"));

    const connection = await h.connect("p1");
    await connection.waitForFrames("live", 1);

    expect(connection.status).toBe(200);
    expect(connection.headers.get("content-type")).toContain("text/event-stream");
    // The snapshot of the turns being written follows the replay: here, none.
    expect(connection.frames).toEqual([
      { event: "heartbeat", id: null, data: "{}" },
      {
        event: "resync",
        id: String(newest.id),
        data: JSON.stringify({ cursor: newest.id, reason: "start" }),
      },
      { event: "live", id: null, data: JSON.stringify({ turns: [] }) },
    ]);
  });

  test("delivers entries in the order they were appended, with the entry id as the SSE id", async () => {
    const connection = await h.connectSettled("p1");

    const first = await h.publisher.publish(threadRemoved("p1", "t1"));
    const second = await h.publisher.publish(threadRemoved("p1", "t2"));
    const third = await h.publisher.publish(threadRemoved("p1", "t3"));
    await connection.waitForFrames("entry", 3);

    expect(connection.entries()).toEqual([first, second, third]);
    expect(
      connection.frames.filter((frame) => frame.event === "entry").map((frame) => frame.id),
    ).toEqual([first, second, third].map((entry) => String(entry.id)));
  });

  test("keeps the order when many entries are appended at once", async () => {
    const connection = await h.connectSettled("p1");

    const appended = await Promise.all(
      Array.from({ length: 30 }, (_, n) => h.publisher.publish(threadRemoved("p1", `t${n}`))),
    );
    await connection.waitForFrames("entry", 30);

    const ids = connection.entries().map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids)).toEqual(new Set(appended.map((entry) => entry.id)));
  });

  describe("resuming", () => {
    test("?after= replays only the later entries of the project, oldest first, then continues live", async () => {
      const first = await h.publisher.publish(threadRemoved("p1", "t1"));
      const second = await h.publisher.publish(threadRemoved("p1", "t2"));
      await h.publisher.publish(threadRemoved("p2", "other"));
      const third = await h.publisher.publish(threadRemoved("p1", "t3"));

      const connection = await h.connect("p1", `?after=${first.id}`);
      await connection.waitForFrames("entry", 2);
      const fourth = await h.publisher.publish(threadRemoved("p1", "t4"));
      await connection.waitForFrames("entry", 3);

      expect(connection.entries()).toEqual([second, third, fourth]);
      expect(connection.frames.some((frame) => frame.event === "resync")).toBe(false);
    });

    test("Last-Event-ID, which a browser sends when it reconnects itself, resumes the same way", async () => {
      const first = await h.publisher.publish(threadRemoved("p1", "t1"));
      const second = await h.publisher.publish(threadRemoved("p1", "t2"));

      const connection = await h.connect("p1", "", { "Last-Event-ID": String(first.id) });
      await connection.waitForFrames("entry", 1);

      expect(connection.entries()).toEqual([second]);
    });

    test("with both ?after= and Last-Event-ID the newer wins: the URL keeps the first cursor, the header moves on", async () => {
      const first = await h.publisher.publish(threadRemoved("p1", "t1"));
      const second = await h.publisher.publish(threadRemoved("p1", "t2"));
      const third = await h.publisher.publish(threadRemoved("p1", "t3"));

      const connection = await h.connect("p1", `?after=${first.id}`, {
        "Last-Event-ID": String(second.id),
      });
      await connection.waitForFrames("entry", 1);

      expect(connection.entries()).toEqual([third]);
    });

    test("a client that reconnects with its last id gets what it missed, once, in order", async () => {
      const seen = await h.connectSettled("p1");
      const a = await h.publisher.publish(threadRemoved("p1", "t1"));
      const b = await h.publisher.publish(threadRemoved("p1", "t2"));
      await seen.waitForFrames("entry", 2);
      seen.close();
      await seen.ended;

      const missed = [
        await h.publisher.publish(threadRemoved("p1", "t3")),
        await h.publisher.publish(threadRemoved("p1", "t4")),
        await h.publisher.publish(threadRemoved("p1", "t5")),
      ];
      const resumed = await h.connect("p1", "", { "Last-Event-ID": String(b.id) });
      await resumed.waitForFrames("entry", 3);
      const live = await h.publisher.publish(threadRemoved("p1", "t6"));
      await resumed.waitForFrames("entry", 4);

      expect(resumed.entries()).toEqual([...missed, live]);
      expect([...seen.entries(), ...resumed.entries()].map((entry) => entry.id)).toEqual(
        [a, b, ...missed, live].map((entry) => entry.id),
      );
    });

    test("a cursor equal to the newest entry replays nothing and stays live", async () => {
      const newest = await h.publisher.publish(threadRemoved("p1", "t1"));

      const connection = await h.connectSettled("p1", `?after=${newest.id}`);
      const next = await h.publisher.publish(threadRemoved("p1", "t2"));
      await connection.waitForFrames("entry", 1);

      expect(connection.entries()).toEqual([next]);
    });
  });

  describe("after a server restart", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "event-stream-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test("resumes from the durable log in a new process, and ids keep increasing", async () => {
      const dbPath = join(dir, "projects.sqlite");
      const before = createDatabase(dbPath);
      await runMigrations(before);
      await createProjects(before, "p1");
      const firstBoot = createCommandContext(before);
      const firstServer = serveEventStream(firstBoot);
      const connection = await openSse(firstServer.streamUrl("p1"));
      await connection.waitForFrames("resync", 1);
      const a = await firstBoot.eventPublisher.publish(threadRemoved("p1", "t1"));
      const b = await firstBoot.eventPublisher.publish(threadRemoved("p1", "t2"));
      await connection.waitForFrames("entry", 2);

      // The process dies: connections drop and memory is gone; only the database file remains.
      connection.close();
      firstServer.stop();
      await before.destroy();

      const after = createDatabase(dbPath);
      await runMigrations(after);
      const secondBoot = createCommandContext(after);
      const secondServer = serveEventStream(secondBoot);
      const c = await secondBoot.eventPublisher.publish(threadRemoved("p1", "t3"));
      const resumed = await openSse(secondServer.streamUrl("p1"), {
        "Last-Event-ID": String(a.id),
      });
      await resumed.waitForFrames("entry", 2);
      const d = await secondBoot.eventPublisher.publish(threadRemoved("p1", "t4"));
      await resumed.waitForFrames("entry", 3);

      expect(resumed.entries()).toEqual([b, c, d]);
      expect(c.id).toBeGreaterThan(b.id);
      resumed.close();
      secondServer.stop();
      await after.destroy();
    });
  });

  describe("isolation and fan-out", () => {
    test("a stream carries nothing of another project, neither entries nor live text", async () => {
      const mine = await h.connectSettled("p1");
      const theirs = await h.connectSettled("p2");

      await h.publisher.publish(threadRemoved("p2", "theirs"));
      h.publisher.publishLive({
        projectId: "p2",
        threadId: null,
        messageId: "m9",
        ops: [{ op: "start", index: 0, part: { type: "text", text: "not for p1" } }],
      });
      const own = await h.publisher.publish(threadRemoved("p1", "mine"));
      await mine.waitForFrames("entry", 1);
      await theirs.waitForFrames("delta", 1);
      await Bun.sleep(30);

      expect(mine.entries()).toEqual([own]);
      expect(mine.frames.some((frame) => frame.event === "delta")).toBe(false);
      expect(theirs.entries().map((entry) => entry.projectId)).toEqual(["p2"]);
    });

    test("replay from cursor 0 never includes another project's entries", async () => {
      await h.publisher.publish(threadRemoved("p2", "theirs"));
      const own = await h.publisher.publish(threadRemoved("p1", "mine"));

      const connection = await h.connect("p1", "?after=0");
      await connection.waitForFrames("entry", 1);
      await Bun.sleep(30);

      expect(connection.entries()).toEqual([own]);
    });

    test("every subscriber of a project receives every entry once, in the same order", async () => {
      const subscribers = await Promise.all([
        h.connectSettled("p1"),
        h.connectSettled("p1"),
        h.connectSettled("p1"),
      ]);

      const appended = [];
      for (let n = 0; n < 5; n++) {
        appended.push(await h.publisher.publish(threadRemoved("p1", `t${n}`)));
      }
      await Promise.all(subscribers.map((subscriber) => subscriber.waitForFrames("entry", 5)));
      await Bun.sleep(30);

      for (const subscriber of subscribers) expect(subscriber.entries()).toEqual(appended);
    });
  });

  describe("heartbeats", () => {
    beforeEach(() => h.serve({ heartbeatIntervalMs: 20 }));

    test("come on an interval without an id, so the resume cursor is untouched", async () => {
      const newest = await h.publisher.publish(threadRemoved("p1", "t1"));

      const connection = await h.connect("p1", `?after=${newest.id}`);
      const beats = await connection.waitForFrames("heartbeat", 4);

      expect(beats.every((beat) => beat.id === null && beat.data === "{}")).toBe(true);
    });

    test("also read the log, so an entry written without the publisher is not stranded", async () => {
      const connection = await h.connectSettled("p1");

      const written = await createEventLogRepository(h.db).append(threadRemoved("p1", "quiet"));
      await connection.waitForFrames("entry", 1);

      expect(connection.entries()).toEqual([written]);
    });

    test("stop, along with the subscription, when the client leaves", async () => {
      const connection = await h.connectSettled("p1");
      expect(h.openSubscriptions()).toBe(1);

      connection.close();
      await connection.ended;
      for (let waited = 0; h.openSubscriptions() > 0 && waited < 1_000; waited += 10) {
        await Bun.sleep(10);
      }

      expect(h.openSubscriptions()).toBe(0);
    });
  });
});
