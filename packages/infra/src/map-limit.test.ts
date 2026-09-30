import { describe, expect, test } from "bun:test";
import { mapLimit } from "./map-limit.ts";

describe("mapLimit", () => {
  test("answers each item's result at its own index, whichever finishes first", async () => {
    const delays = [30, 5, 20, 0, 10];

    const results = await mapLimit(delays, 2, async (delay) => {
      await Bun.sleep(delay);
      return `waited ${delay}`;
    });

    expect(results).toEqual(delays.map((delay) => `waited ${delay}`));
  });

  test("never has more than the limit in flight, and uses all of it", async () => {
    let inFlight = 0;
    let most = 0;

    await mapLimit(
      Array.from({ length: 20 }, (_, index) => index),
      3,
      async (index) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await Bun.sleep(index % 4);
        inFlight -= 1;
      },
    );

    expect(most).toBe(3);
    expect(inFlight).toBe(0);
  });

  test("runs every item once, even with fewer items than the limit or none", async () => {
    const seen: number[] = [];

    const results = await mapLimit([1, 2], 8, async (item) => {
      seen.push(item);
      return item * 10;
    });

    expect(results).toEqual([10, 20]);
    expect(seen.sort()).toEqual([1, 2]);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
