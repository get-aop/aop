import { describe, expect, test } from "bun:test";
import type { MessageDelta } from "@aop/common";
import { createLiveTurnMirror } from "./live-turn-mirror";

const delta = (messageId: string, ops: MessageDelta["ops"], threadId: string | null = null) => ({
  projectId: "prj_1",
  threadId,
  messageId,
  ops,
});
const text = (value: string) => ({ type: "text" as const, text: value });

describe("createLiveTurnMirror", () => {
  test("holds each turn as the stream built it, handed out as a baseline", () => {
    const mirror = createLiveTurnMirror();
    mirror.hear({
      kind: "delta",
      delta: { ...delta("a1", [{ op: "start", index: 0, part: text("Hel") }]), inReplyTo: "u1" },
    });
    mirror.hear({ kind: "delta", delta: delta("a1", [{ op: "append", index: 0, text: "lo" }]) });

    expect(mirror.baselines()).toEqual([
      { ...delta("a1", [{ op: "reset", parts: [text("Hello")] }]), inReplyTo: "u1" },
    ]);
  });

  test("a snapshot replaces what it held; a reply, the end of a turn or its thread going forgets it", () => {
    const mirror = createLiveTurnMirror();
    mirror.hear({
      kind: "delta",
      delta: delta("old", [{ op: "start", index: 0, part: text("x") }]),
    });
    mirror.hear({
      kind: "live",
      snapshot: {
        turns: [
          delta("a1", [{ op: "reset", parts: [text("one")] }]),
          delta("t1", [{ op: "reset", parts: [text("two")] }], "thr_1"),
          delta("e1", [{ op: "reset", parts: [text("three")] }]),
        ],
      },
    });
    expect(mirror.baselines().map((turn) => turn.messageId)).toEqual(["a1", "t1", "e1"]);

    mirror.hear({ kind: "delta", delta: delta("e1", [{ op: "end" }]) });
    mirror.hear({
      kind: "entry",
      entry: { id: 4, projectId: "prj_1", type: "thread.removed", payload: { threadId: "thr_1" } },
    });
    mirror.hear({
      kind: "entry",
      entry: {
        id: 5,
        projectId: "prj_1",
        type: "message.created",
        payload: {
          message: {
            id: "a1",
            projectId: "prj_1",
            threadId: null,
            createdAt: "2026-10-01T00:00:00.000Z",
            role: "assistant",
            blocks: [text("one")],
          },
        },
      },
    });

    expect(mirror.baselines()).toEqual([]);
  });
});
