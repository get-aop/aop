import { afterEach, describe, expect, jest, test } from "bun:test";
import { startPeriodicJob } from "./periodic-job.ts";

describe("startPeriodicJob", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a failed run is logged and the next tick runs again", async () => {
    jest.useFakeTimers();
    let calls = 0;
    const stop = startPeriodicJob({
      name: "test job",
      run: async () => {
        calls++;
        throw new Error("boom");
      },
      startupDelayMs: 10,
      intervalMs: 100,
    });
    jest.advanceTimersByTime(10);
    expect(calls).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    expect(calls).toBe(2);
    stop();
    jest.advanceTimersByTime(1000);
    expect(calls).toBe(2);
  });
});
