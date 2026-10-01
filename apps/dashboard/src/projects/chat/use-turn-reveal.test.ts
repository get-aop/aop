import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { useTurnReveal, WORD_WAIT_MS } from "./use-turn-reveal";

setupDashboardDom();

const { act, cleanup, renderHook } = await import("@testing-library/react");

// happy-dom runs rAF on setImmediate, so frames would all fire at once: step a 60 Hz clock by hand.
const originalRaf = globalThis.requestAnimationFrame;
const originalCaf = globalThis.cancelAnimationFrame;
const originalNow = performance.now;
let frames: Array<{ id: number; run: () => void }> = [];
let cancelled = new Set<number>();
let nextId = 1;
let clock = 0;

const step = (count: number) => {
  for (let done = 0; done < count && frames.length > 0; ) {
    const { id, run } = frames.shift() as { id: number; run: () => void };
    if (cancelled.has(id)) continue;
    done += 1;
    act(() => run());
  }
};

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const shownText = (blocks: readonly MessageBlock[]) =>
  blocks.map((block) => (block.type === "text" ? block.text : `[${block.type}]`)).join("|");

describe("useTurnReveal", () => {
  beforeEach(() => {
    frames = [];
    cancelled = new Set();
    nextId = 1;
    clock = 0;
    performance.now = (() => clock) as typeof performance.now;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.push({
        id,
        run: () => {
          clock += 1000 / 60;
          callback(clock);
        },
      });
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      cancelled.add(id)) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    performance.now = originalNow;
    cleanup();
  });

  test("a message from history, or a reply joined mid-turn, shows what it has at once", () => {
    const history = renderHook(() => useTurnReveal([text("Done.")], false));
    expect(shownText(history.result.current.blocks)).toBe("Done.");
    expect(history.result.current.revealing).toBe(false);

    const joined = renderHook(() => useTurnReveal([text("Halfway through ")], true));
    expect(shownText(joined.result.current.blocks)).toBe("Halfway through ");
  });

  test("prose that arrives is typed out word by word, then the end drains instead of snapping", () => {
    const { result, rerender } = renderHook(
      ({ blocks, writing }: { blocks: MessageBlock[]; writing: boolean }) =>
        useTurnReveal(blocks, writing),
      { initialProps: { blocks: [text("Hi ")], writing: true } },
    );
    const arrived = "Hi there, this is the rest of a reply that arrived in one go.";
    rerender({ blocks: [text(arrived)], writing: true });
    expect(shownText(result.current.blocks)).toBe("Hi ");

    step(6);
    const partway = shownText(result.current.blocks);
    expect(partway.length).toBeGreaterThan(3);
    expect(partway.length).toBeLessThan(arrived.length);
    expect(arrived.startsWith(partway)).toBe(true);
    expect(partway.endsWith(" ")).toBe(true);

    // The turn ends with more text: it is not dropped in, it keeps typing.
    const final = `${arrived} And a closing line.`;
    rerender({
      blocks: [text(final), { type: "thread-card", threadId: "t1", variant: "live" }],
      writing: false,
    });
    expect(shownText(result.current.blocks).length).toBeLessThan(final.length);
    expect(result.current.revealing).toBe(true);

    step(120);
    expect(shownText(result.current.blocks)).toBe(`${final}|[thread-card]`);
    expect(result.current.revealing).toBe(false);
  });

  test("a word at the end waits for the rest of it, then shows once the prose stops growing", async () => {
    const { result } = renderHook(() => useTurnReveal([text("Looking at the reque")], true));
    expect(shownText(result.current.blocks)).toBe("Looking at the ");

    await act(() => new Promise((resolve) => setTimeout(resolve, WORD_WAIT_MS + 50)));

    expect(shownText(result.current.blocks)).toBe("Looking at the reque");
  });

  test("a baseline that replaces the prose with a longer one goes on from what was shown", () => {
    const { result, rerender } = renderHook(
      ({ blocks }: { blocks: MessageBlock[] }) => useTurnReveal(blocks, true),
      { initialProps: { blocks: [text("Looking at the code ")] } },
    );
    rerender({ blocks: [text("Looking at the code now. ")] });
    expect(shownText(result.current.blocks)).toBe("Looking at the code ");
  });
});
