import { describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import {
  advanceReveal,
  MAX_FRAME_SECONDS,
  REVEAL_FLOOR_CPS,
  REVEAL_LAG_SECONDS,
  revealedBlocks,
  shownChars,
} from "./turn-reveal";

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const tool: MessageBlock = { type: "tool", id: "t1", name: "Bash", detail: "ls", status: "done" };

/** Frames of a 60 Hz display until the reveal catches up; how long that took. */
const secondsToCatchUp = (revealed: number, total: number): number => {
  let seconds = 0;
  let at = revealed;
  while (at < total && seconds < 10) {
    at = advanceReveal(at, total, 1 / 60);
    seconds += 1 / 60;
  }
  return seconds;
};

describe("advanceReveal", () => {
  test("text streaming in stays about the lag behind: no stall, no burst", () => {
    // 60 characters a second, arriving in 100 ms batches, on a 60 Hz display, for 5 seconds.
    let total = 0;
    let revealed = 0;
    for (let frame = 1; frame <= 300; frame++) {
      if (frame % 6 === 0) total += 6;
      revealed = advanceReveal(revealed, total, 1 / 60);
    }
    const behindSeconds = (total - revealed) / 60;
    expect(behindSeconds).toBeLessThanOrEqual(REVEAL_LAG_SECONDS + 0.05);
    expect(behindSeconds).toBeGreaterThanOrEqual(0);
  });

  test("what is left when the turn ends drains quickly; a large dump catches up within seconds", () => {
    // The backlog a 60 cps stream leaves behind.
    expect(secondsToCatchUp(0, 24)).toBeLessThanOrEqual(0.35);
    expect(secondsToCatchUp(0, 600)).toBeLessThan(2);
    expect(secondsToCatchUp(0, 20_000)).toBeLessThan(3.5);
  });

  test("a trickle types at the floor, and never past what arrived", () => {
    expect(advanceReveal(0, 4, 0.01)).toBeCloseTo(REVEAL_FLOOR_CPS * 0.01);
    expect(advanceReveal(3.9, 4, 0.5)).toBe(4);
    expect(advanceReveal(5, 4, 0.01)).toBe(4);
  });

  test("a long gap between frames (a background tab) moves it at most one capped frame", () => {
    expect(advanceReveal(0, 100_000, 30)).toBeCloseTo(
      (100_000 / REVEAL_LAG_SECONDS) * MAX_FRAME_SECONDS,
    );
  });
});

describe("shownChars", () => {
  test("shows whole words only", () => {
    expect(shownChars(["Hello world, again"], 3, true)).toBe(0);
    expect(shownChars(["Hello world, again"], 5, true)).toBe(5);
    expect(shownChars(["Hello world, again"], 9, true)).toBe(6);
  });

  test("while the turn is written, the word still arriving at the end waits", () => {
    expect(shownChars(["Hello wor"], 9, true)).toBe(6);
    expect(shownChars(["Hello "], 6, true)).toBe(6);
  });

  test("once the turn is finished, everything is shown when the reveal reaches it", () => {
    expect(shownChars(["Hello wor"], 9, false)).toBe(9);
    expect(shownChars(["Hello wor"], 7, false)).toBe(6);
  });

  test("the end of a block is a word boundary", () => {
    expect(shownChars(["Looking.", "Done here"], 8, true)).toBe(8);
    expect(shownChars(["Looking.", "Done here"], 10, true)).toBe(8);
    expect(shownChars(["Looking.", "Done here"], 12, true)).toBe(12);
  });
});

describe("revealedBlocks", () => {
  test("cuts the prose at the reveal and shows other blocks once the prose before them is shown", () => {
    const blocks = [text("Looking."), tool, text("Done.")];
    expect(revealedBlocks(blocks, 4)).toEqual([text("Look")]);
    expect(revealedBlocks(blocks, 8)).toEqual([text("Looking."), tool]);
    expect(revealedBlocks(blocks, 10)).toEqual([text("Looking."), tool, text("Do")]);
  });

  test("a block before any prose shows at once, and a fully revealed reply is the same array", () => {
    const blocks = [tool, text("Done.")];
    expect(revealedBlocks(blocks, 0)).toEqual([tool]);
    expect(revealedBlocks(blocks, 5)).toBe(blocks);
  });
});
