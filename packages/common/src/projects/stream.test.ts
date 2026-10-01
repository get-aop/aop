import { describe, expect, test } from "bun:test";
import {
  LiveSnapshotSchema,
  MessageDeltaSchema,
  PROJECT_STREAM_EVENTS,
  ResyncSchema,
} from "./stream.ts";
import { parsed, rejectedPaths } from "./test-utils.ts";

const makeDelta = (overrides: Record<string, unknown> = {}) => ({
  projectId: "prj_1",
  threadId: "thr_1",
  messageId: "msg_9",
  ops: [{ op: "append", index: 0, text: "Looking at the " }],
  ...overrides,
});

describe("MessageDeltaSchema", () => {
  test("accepts a thread's delta and the coordinator's (no thread)", () => {
    expect(parsed(MessageDeltaSchema, makeDelta())).toEqual(makeDelta());
    expect(parsed(MessageDeltaSchema, makeDelta({ threadId: null }))).toEqual(
      makeDelta({ threadId: null }),
    );
  });

  test("accepts the message the turn answers", () => {
    expect(parsed(MessageDeltaSchema, makeDelta({ inReplyTo: "msg_1" }))).toEqual(
      makeDelta({ inReplyTo: "msg_1" }),
    );
  });

  test("accepts every op: a baseline, a new part, appended text, a tool update, and the end", () => {
    const ops = [
      { op: "reset", parts: [{ type: "thinking", text: "Plan" }] },
      {
        op: "start",
        index: 1,
        part: { type: "tool", id: "t1", name: "Bash", detail: null, status: "running" },
      },
      { op: "append", index: 0, text: " it" },
      { op: "tool", index: 1, status: "done", detail: "ls" },
      { op: "end" },
    ];
    expect(parsed(MessageDeltaSchema, makeDelta({ ops }))).toEqual(makeDelta({ ops }));
  });

  test("rejects a delta with no ops, an empty append, or a part no turn can hold", () => {
    expect(rejectedPaths(MessageDeltaSchema, makeDelta({ ops: [] }))).toEqual(["ops"]);
    expect(
      rejectedPaths(MessageDeltaSchema, makeDelta({ ops: [{ op: "append", index: 0, text: "" }] })),
    ).toEqual(["ops.0.text"]);
    const card = { type: "thread-card", threadId: "t1", variant: "live" };
    expect(
      rejectedPaths(
        MessageDeltaSchema,
        makeDelta({ ops: [{ op: "start", index: 0, part: card }] }),
      ),
    ).toEqual(["ops.0.part.type"]);
  });

  test("rejects a delta that does not say which message it is", () => {
    const { messageId: _messageId, ...incomplete } = makeDelta();
    expect(rejectedPaths(MessageDeltaSchema, incomplete)).toEqual(["messageId"]);
  });
});

describe("ResyncSchema", () => {
  test("accepts every reason with a cursor", () => {
    for (const reason of ["start", "trimmed", "ahead", "too-large", "unreadable"]) {
      expect(parsed(ResyncSchema, { cursor: 12, reason })).toEqual({ cursor: 12, reason });
    }
  });

  test("rejects an unknown reason and a cursor that is not an id", () => {
    expect(rejectedPaths(ResyncSchema, { cursor: 12, reason: "because" })).toEqual(["reason"]);
    expect(rejectedPaths(ResyncSchema, { cursor: -1, reason: "start" })).toEqual(["cursor"]);
    expect(rejectedPaths(ResyncSchema, { cursor: 1.5, reason: "start" })).toEqual(["cursor"]);
  });
});

describe("LiveSnapshotSchema", () => {
  test("holds the turns being written, possibly none", () => {
    expect(parsed(LiveSnapshotSchema, { turns: [] })).toEqual({ turns: [] });
    const turns = [makeDelta({ ops: [{ op: "reset", parts: [] }] })];
    expect(parsed(LiveSnapshotSchema, { turns })).toEqual({ turns });
    expect(
      rejectedPaths(LiveSnapshotSchema, { turns: [{ messageId: "m" }] }).length,
    ).toBeGreaterThan(0);
  });
});

test("the stream sends five kinds of event", () => {
  expect(Object.values(PROJECT_STREAM_EVENTS).sort()).toEqual([
    "delta",
    "entry",
    "heartbeat",
    "live",
    "resync",
  ]);
});
