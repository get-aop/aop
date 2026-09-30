import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MessageDeltaSchema } from "@aop/common";
import { createEventLogRepository } from "./repository.ts";
import type { SseConnection } from "./sse-test-client.ts";
import { assistantReply, createStreamHarness, liveText, type StreamHarness } from "./test-utils.ts";

const deltasOf = (connection: SseConnection) =>
  connection.frames
    .filter((frame) => frame.event === "delta")
    .map((frame) => MessageDeltaSchema.parse(JSON.parse(frame.data)));

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

    h.publisher.publishLive(liveText({ text: "Hel" }));
    await connection.waitForFrames("delta", 1);
    h.publisher.publishLive(liveText({ text: "lo" }));
    await connection.waitForFrames("delta", 2);

    expect(deltasOf(connection)).toEqual([liveText({ text: "Hel" }), liveText({ text: "lo" })]);
    expect(
      connection.frames.filter((frame) => frame.event === "delta").map((frame) => frame.id),
    ).toEqual([null, null]);
    expect(await createEventLogRepository(h.db).listAfter("p1", 0)).toEqual([]);
  });

  test("a client that connects mid-turn gets the text so far as a baseline, then only what follows", async () => {
    h.publisher.publishLive(liveText({ text: "Hel" }));
    h.publisher.publishLive(liveText({ text: "lo " }));

    const connection = await h.connect("p1");
    await connection.waitForFrames("delta", 1);
    h.publisher.publishLive(liveText({ text: "world" }));
    await connection.waitForFrames("delta", 2);

    expect(deltasOf(connection)).toEqual([
      liveText({ text: "Hello ", replace: true }),
      liveText({ text: "world", replace: false }),
    ]);
  });

  test("the coordinator's turn and a thread's turn each get their own baseline", async () => {
    h.publisher.publishLive(liveText({ messageId: "m1", threadId: null, text: "coordinating" }));
    h.publisher.publishLive(liveText({ messageId: "m2", threadId: "t1", text: "bisecting" }));

    const connection = await h.connect("p1");
    await connection.waitForFrames("delta", 2);

    expect(deltasOf(connection)).toEqual([
      liveText({ messageId: "m1", threadId: null, text: "coordinating", replace: true }),
      liveText({ messageId: "m2", threadId: "t1", text: "bisecting", replace: true }),
    ]);
  });

  test("ends with the message: a client connecting after the reply is created gets no baseline for it", async () => {
    h.publisher.publishLive(liveText({ text: "Hello" }));
    const reply = await h.publisher.publish(assistantReply("p1", "m1"));

    // Resuming past the reply, so the log has nothing to say about m1: only the baseline could.
    const connection = await h.connectSettled("p1", `?after=${reply.id}`);
    await Bun.sleep(30);

    expect(deltasOf(connection)).toEqual([]);
  });

  test("a turn that produced no message is ended by clearLive: open clients drop it, new ones get no baseline", async () => {
    const open = await h.connectSettled("p1");
    h.publisher.publishLive(liveText({ text: "Hel" }));
    await open.waitForFrames("delta", 1);

    h.publisher.clearLive("p1", null, "m1");
    await open.waitForFrames("delta", 2);
    const late = await h.connectSettled("p1");
    await Bun.sleep(30);

    expect(deltasOf(open).at(-1)).toEqual(liveText({ text: "", replace: true }));
    expect(deltasOf(late)).toEqual([]);
  });

  test("text still waiting when its message is committed is dropped instead of sent after it", async () => {
    const connection = await h.connectSettled("p1");

    // The transaction holds the database connection, so the stream's read of the log waits
    // behind it: the live text is queued before the reply that supersedes it can be read.
    await h.publisher.transaction(async ({ append }) => {
      h.publisher.publishLive(liveText({ text: "partial" }));
      await Bun.sleep(20);
      await append(assistantReply("p1", "m1"));
    });
    await connection.waitForFrames("entry", 1);
    await Bun.sleep(30);

    expect(deltasOf(connection)).toEqual([]);
  });
});
