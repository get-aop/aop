import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LiveSnapshotSchema, MessageDeltaSchema } from "@aop/common";
import { createEventLogRepository } from "./repository.ts";
import type { SseConnection } from "./sse-test-client.ts";
import {
  appended,
  assistantReply,
  baseline,
  createStreamHarness,
  liveDelta,
  type StreamHarness,
  started,
} from "./test-utils.ts";

// The turns of the connection's opening snapshot, then the deltas that followed it.
const deltasOf = (connection: SseConnection) =>
  connection.frames.flatMap((frame) => {
    if (frame.event === "live") return LiveSnapshotSchema.parse(JSON.parse(frame.data)).turns;
    return frame.event === "delta" ? [MessageDeltaSchema.parse(JSON.parse(frame.data))] : [];
  });

describe("project event stream: live message text", () => {
  let h: StreamHarness;

  beforeEach(async () => {
    h = await createStreamHarness();
  });

  afterEach(async () => {
    await h.dispose();
  });

  test("arrives as it is written, without an id, and is never stored", async () => {
    const connection = await h.connectSettled("p1");

    h.publisher.publishLive(started("Hel"));
    await connection.waitForFrames("delta", 1);
    h.publisher.publishLive(appended("lo"));
    await connection.waitForFrames("delta", 2);

    expect(deltasOf(connection)).toEqual([started("Hel"), appended("lo")]);
    expect(
      connection.frames.filter((frame) => frame.event === "delta").map((frame) => frame.id),
    ).toEqual([null, null]);
    expect(await createEventLogRepository(h.db).listAfter("p1", 0)).toEqual([]);
  });

  test("a client that connects mid-turn gets the turn so far as a baseline, then only what follows", async () => {
    h.publisher.publishLive(started("Hel"));
    h.publisher.publishLive(appended("lo "));

    const connection = await h.connect("p1");
    await connection.waitForFrames("live", 1);
    h.publisher.publishLive(appended("world"));
    await connection.waitForFrames("delta", 1);

    expect(deltasOf(connection)).toEqual([baseline("Hello "), appended("world")]);
  });

  test("the coordinator's turn and a thread's turn each get their own baseline", async () => {
    h.publisher.publishLive(started("coordinating", { messageId: "m1", threadId: null }));
    h.publisher.publishLive(started("bisecting", { messageId: "m2", threadId: "t1" }));

    const connection = await h.connect("p1");
    await connection.waitForFrames("live", 1);

    expect(connection.frames.filter((frame) => frame.event === "live")).toHaveLength(1);
    expect(deltasOf(connection)).toEqual([
      baseline("coordinating", { messageId: "m1", threadId: null }),
      baseline("bisecting", { messageId: "m2", threadId: "t1" }),
    ]);
  });

  test("ends with the message: a client connecting after the reply is created gets no baseline for it", async () => {
    h.publisher.publishLive(started("Hello"));
    const reply = await h.publisher.publish(assistantReply("p1", "m1"));

    // Resuming past the reply, so the log has nothing to say about m1: only the baseline could.
    const connection = await h.connectSettled("p1", `?after=${reply.id}`);
    await Bun.sleep(30);

    expect(deltasOf(connection)).toEqual([]);
  });

  test("a turn that produced no message is ended by clearLive: open clients drop it, new ones get no baseline", async () => {
    const open = await h.connectSettled("p1");
    h.publisher.publishLive(started("Hel"));
    await open.waitForFrames("delta", 1);

    h.publisher.clearLive("p1", null, "m1");
    await open.waitForFrames("delta", 2);
    const late = await h.connectSettled("p1");
    await Bun.sleep(30);

    expect(deltasOf(open).at(-1)).toEqual(liveDelta([{ op: "end" }]));
    expect(deltasOf(late)).toEqual([]);
  });

  test("text still waiting when its message is committed is dropped instead of sent after it", async () => {
    const connection = await h.connectSettled("p1");

    // The transaction holds the database connection, so the stream's read of the log waits
    // behind it: the live text is queued before the reply that supersedes it can be read.
    await h.publisher.transaction(async ({ append }) => {
      h.publisher.publishLive(started("partial"));
      await Bun.sleep(20);
      await append(assistantReply("p1", "m1"));
    });
    await connection.waitForFrames("entry", 1);
    await Bun.sleep(30);

    expect(deltasOf(connection)).toEqual([]);
  });
});
