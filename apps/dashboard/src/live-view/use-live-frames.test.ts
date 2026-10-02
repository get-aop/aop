import { describe, expect, test } from "bun:test";
import { FAILED_DELAY_MS, IDLE_DELAY_MS, MIN_DELAY_MS, nextDelay } from "./use-live-frames";

const frame = { kind: "frame" as const, blob: new Blob([]), etag: '"1"' };
const unchanged = { kind: "unchanged" as const };
const refused = (code: string) => ({ kind: "refused" as const, code, error: "" });

describe("the live view's pace", () => {
  test("polls fast while the picture changes over a quick link", () => {
    expect(nextDelay(frame, 20, IDLE_DELAY_MS)).toEqual({
      delay: MIN_DELAY_MS,
      idle: MIN_DELAY_MS,
    });
  });

  test("never asks faster than twice what the last request took", () => {
    expect(nextDelay(frame, 400, MIN_DELAY_MS).delay).toBe(800);
    expect(nextDelay(frame, 900, MIN_DELAY_MS).delay).toBe(IDLE_DELAY_MS);
  });

  test("slows down while the screen stands still, up to once a second", () => {
    let idle = MIN_DELAY_MS;
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = nextDelay(unchanged, 10, idle);
      idle = next.idle;
      delays.push(next.delay);
    }
    expect(delays).toEqual([375, 562.5, 843.75, 1000, 1000, 1000]);
  });

  test("waits longer when the host cannot capture or does not answer", () => {
    expect(nextDelay(refused("LIVE_VIEW_UNAVAILABLE"), 10, MIN_DELAY_MS).delay).toBe(
      FAILED_DELAY_MS,
    );
    expect(nextDelay(null, 10, MIN_DELAY_MS).delay).toBe(FAILED_DELAY_MS);
    expect(nextDelay(refused("LIVE_VIEW_STARTING"), 10, MIN_DELAY_MS).delay).toBe(500);
  });
});
