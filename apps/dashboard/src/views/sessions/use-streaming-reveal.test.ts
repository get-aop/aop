import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { useStreamingReveal } from "./use-streaming-reveal";

setupDashboardDom();

const { act, cleanup, renderHook } = await import("@testing-library/react");

// happy-dom drives rAF with setImmediate, so frames would all fire at once.
// Stub a manually-stepped frame queue to make reveal timing deterministic.
const originalRaf = globalThis.requestAnimationFrame;
const originalCaf = globalThis.cancelAnimationFrame;
let queuedFrames: Array<{ id: number; fn: () => void }> = [];
let cancelledFrames = new Set<number>();
let nextFrameId = 1;

const stepFrames = (count: number) => {
  let executed = 0;
  while (executed < count && queuedFrames.length > 0) {
    const { id, fn } = queuedFrames.shift() as { id: number; fn: () => void };
    if (!cancelledFrames.has(id)) {
      executed += 1;
      fn();
    }
  }
};

describe("useStreamingReveal", () => {
  beforeEach(() => {
    queuedFrames = [];
    cancelledFrames = new Set();
    nextFrameId = 1;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      queuedFrames.push({ id, fn: () => callback(performance.now()) });
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      cancelledFrames.add(id);
    }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    queuedFrames = [];
    cleanup();
  });

  test("shows the full text immediately when the run is not active", () => {
    const { result } = renderHook(() => useStreamingReveal("hello world", false));
    expect(result.current).toBe("hello world");
  });

  test("reveals an active stream gradually instead of at once", async () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useStreamingReveal(target, active),
      { initialProps: { target: "", active: true } },
    );
    expect(result.current).toBe("");

    rerender({ target: "a".repeat(500), active: true });
    await act(async () => stepFrames(1));
    // A bounded amount per frame — the full chunk must not appear instantly.
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan(500);

    // Once frames pass, the reveal catches up to the full text.
    await act(async () => stepFrames(30));
    expect(result.current).toBe("a".repeat(500));
  });

  test("a paused stream finishes revealing the pending text", async () => {
    const { result } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useStreamingReveal(target, active),
      { initialProps: { target: "x".repeat(300), active: true } },
    );
    await act(async () => stepFrames(1));
    expect(result.current.length).toBeLessThan(300);

    // No new frames arrive; the base pace keeps typing until done.
    await act(async () => stepFrames(30));
    expect(result.current).toBe("x".repeat(300));
  });

  test("snaps to full text when the stream deactivates mid-reveal", async () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useStreamingReveal(target, active),
      { initialProps: { target: "y".repeat(800), active: true } },
    );
    await act(async () => stepFrames(2));
    expect(result.current.length).toBeLessThan(800);

    rerender({ target: "y".repeat(800), active: false });
    expect(result.current).toBe("y".repeat(800));
  });

  test("never shows characters beyond the current target", async () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useStreamingReveal(target, active),
      { initialProps: { target: "z".repeat(600), active: true } },
    );
    await act(async () => stepFrames(2));

    // A shorter replay frame clamps the reveal down instead of overflowing.
    rerender({ target: "short", active: true });
    await act(async () => stepFrames(1));
    expect(result.current).toBe("short");
  });
});
