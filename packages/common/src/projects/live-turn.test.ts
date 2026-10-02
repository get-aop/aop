import { describe, expect, test } from "bun:test";
import type { TurnPart } from "./blocks.ts";
import { applyLiveOps, compactLiveOps, diffTurnParts } from "./live-turn.ts";
import type { LiveOp } from "./stream.ts";

const text = (value: string): TurnPart => ({ type: "text", text: value });
const thinking = (value: string): TurnPart => ({ type: "thinking", text: value });
const tool = (status: "running" | "done" | "failed", detail: string | null = null): TurnPart => ({
  type: "tool",
  id: "t1",
  name: "Bash",
  detail,
  status,
});

describe("diffTurnParts and applyLiveOps", () => {
  test("a turn growing token by token is sent as appends, new parts and tool updates", () => {
    const before = [thinking("Plan"), text("Looking at "), tool("running")];
    const after = [
      thinking("Plan it"),
      text("Looking at the code."),
      tool("done", "ls"),
      text("Done"),
    ];

    const ops = diffTurnParts(before, after);

    expect(ops).toEqual([
      { op: "append", index: 0, text: " it" },
      { op: "append", index: 1, text: "the code." },
      { op: "tool", index: 2, status: "done", detail: "ls" },
      { op: "start", index: 3, part: text("Done") },
    ]);
    expect(applyLiveOps(before, ops)).toEqual(after);
  });

  test("nothing new is no ops; a part changed in place, or fewer parts, is a reset", () => {
    const parts = [text("Hello"), tool("running")];
    expect(diffTurnParts(parts, parts)).toEqual([]);
    expect(diffTurnParts(parts, [text("Help"), tool("running")])).toEqual([
      { op: "reset", parts: [text("Help"), tool("running")] },
    ]);
    expect(diffTurnParts(parts, [text("Hello")])).toEqual([
      { op: "reset", parts: [text("Hello")] },
    ]);
    expect(diffTurnParts([thinking("x")], [text("x")])).toEqual([
      { op: "reset", parts: [text("x")] },
    ]);
  });

  test("an artifact card starts once and is then left alone; another version is a reset", () => {
    const card = (version: number): TurnPart => ({
      type: "artifact",
      toolId: "t1",
      artifactId: "lib_1",
      version,
      title: "Plan",
      kind: "markdown",
      action: "created",
    });
    const before = [tool("done")];
    const ops = diffTurnParts(before, [tool("done"), card(1)]);
    expect(ops).toEqual([{ op: "start", index: 1, part: card(1) }]);
    expect(applyLiveOps(before, ops)).toEqual([tool("done"), card(1)]);
    expect(diffTurnParts([card(1)], [card(1), text("Done")])).toEqual([
      { op: "start", index: 1, part: text("Done") },
    ]);
    expect(diffTurnParts([card(1)], [card(2)])).toEqual([{ op: "reset", parts: [card(2)] }]);
  });

  test("any sequence of turns is rebuilt exactly from the ops between them", () => {
    const turns: TurnPart[][] = [
      [],
      [thinking("H")],
      [thinking("Hmm."), text("I")],
      [thinking("Hmm."), text("I will"), tool("running")],
      [thinking("Hmm."), text("I will"), tool("failed", "bun test"), text("It failed.")],
      [text("Replaced entirely")],
    ];
    let held: TurnPart[] = [];
    for (let at = 1; at < turns.length; at++) {
      held =
        applyLiveOps(held, diffTurnParts(turns[at - 1] as TurnPart[], turns[at] as TurnPart[])) ??
        [];
      expect(held).toEqual(turns[at] as TurnPart[]);
    }
  });

  test("end drops the turn, a reset after it brings it back, and an op for a part not held is skipped", () => {
    expect(applyLiveOps([text("Hi")], [{ op: "end" }])).toBeNull();
    expect(
      applyLiveOps([text("Hi")], [{ op: "end" }, { op: "reset", parts: [text("Again")] }]),
    ).toEqual([text("Again")]);
    expect(applyLiveOps([text("Hi")], [{ op: "append", index: 4, text: "!" }])).toEqual([
      text("Hi"),
    ]);
    expect(applyLiveOps([text("Hi")], [{ op: "start", index: 3, part: text("x") }])).toEqual([
      text("Hi"),
    ]);
    expect(applyLiveOps([tool("running")], [{ op: "append", index: 0, text: "!" }])).toEqual([
      tool("running"),
    ]);
  });
});

describe("compactLiveOps", () => {
  test("drops what a later reset or end makes obsolete and joins appends to one part", () => {
    const ops: LiveOp[] = [
      { op: "append", index: 0, text: "a" },
      { op: "reset", parts: [text("base")] },
      { op: "append", index: 0, text: " one" },
      { op: "append", index: 0, text: " two" },
      { op: "start", index: 1, part: tool("running") },
      { op: "append", index: 0, text: "!" },
    ];

    expect(compactLiveOps(ops)).toEqual([
      { op: "reset", parts: [text("base")] },
      { op: "append", index: 0, text: " one two" },
      { op: "start", index: 1, part: tool("running") },
      { op: "append", index: 0, text: "!" },
    ]);
    expect(compactLiveOps([...ops, { op: "end" }])).toEqual([{ op: "end" }]);
  });

  test("compacting changes nothing a client ends up holding", () => {
    const ops: LiveOp[] = [
      { op: "start", index: 0, part: text("A") },
      { op: "append", index: 0, text: "B" },
      { op: "append", index: 0, text: "C" },
      { op: "start", index: 1, part: tool("running") },
      { op: "tool", index: 1, status: "done", detail: "x" },
    ];
    expect(applyLiveOps([], compactLiveOps(ops))).toEqual(applyLiveOps([], ops));
  });
});
