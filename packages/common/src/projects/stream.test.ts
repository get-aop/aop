import { describe, expect, test } from "bun:test";
import { MessageDeltaSchema, PROJECT_STREAM_EVENTS, ResyncSchema } from "./stream.ts";
import { parsed, rejectedPaths } from "./test-utils.ts";

const makeDelta = (overrides: Record<string, unknown> = {}) => ({
  projectId: "prj_1",
  threadId: "thr_1",
  messageId: "msg_9",
  text: "Looking at the ",
  replace: false,
  ...overrides,
});

describe("MessageDeltaSchema", () => {
  test("accepts a thread's delta and the coordinator's (no thread)", () => {
    expect(parsed(MessageDeltaSchema, makeDelta())).toEqual(makeDelta());
    expect(parsed(MessageDeltaSchema, makeDelta({ threadId: null }))).toEqual(
      makeDelta({ threadId: null }),
    );
  });

  test("accepts an empty replacement, which clears a turn that ended without a message", () => {
    const clear = makeDelta({ text: "", replace: true });
    expect(parsed(MessageDeltaSchema, clear)).toEqual(clear);
  });

  test("rejects a delta that does not say which message it is or whether it replaces the text", () => {
    const { replace: _replace, messageId: _messageId, ...incomplete } = makeDelta();
    expect(rejectedPaths(MessageDeltaSchema, incomplete).sort()).toEqual(["messageId", "replace"]);
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

test("the stream sends four kinds of event", () => {
  expect(Object.values(PROJECT_STREAM_EVENTS).sort()).toEqual([
    "delta",
    "entry",
    "heartbeat",
    "resync",
  ]);
});
