import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  type CheckScheduler,
  createCheckScheduler,
  DUE_POLL_MS,
  STARTUP_CHECK_DELAY_MS,
} from "./check-scheduler.ts";

const MINUTE = 60_000;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

// Moves the fake clock in wake-up sized steps, letting each wake-up's async work settle and
// schedule the next one, the way time passes for the real scheduler.
const advance = async (ms: number) => {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, DUE_POLL_MS);
    jest.advanceTimersByTime(step);
    await flush();
    left -= step;
  }
};

describe("createCheckScheduler", () => {
  let interval: number;
  let results: boolean[];
  let checks: number;
  let scheduler: CheckScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    interval = 60;
    results = [];
    checks = 0;
    scheduler = createCheckScheduler({
      intervalMinutes: async () => interval,
      check: async () => {
        checks++;
        return results.shift() ?? true;
      },
    });
  });

  afterEach(() => {
    scheduler.stop();
    jest.useRealTimers();
  });

  test("checks once shortly after start, then once per interval", async () => {
    scheduler.start();
    await advance(STARTUP_CHECK_DELAY_MS - 1);
    expect(checks).toBe(0);
    await advance(1);
    expect(checks).toBe(1);

    await advance(59 * MINUTE);
    expect(checks).toBe(1);
    await advance(2 * MINUTE);
    expect(checks).toBe(2);
    await advance(60 * MINUTE);
    expect(checks).toBe(3);
  });

  test("an interval of 0 turns the check off, startup included, and turning it on resumes", async () => {
    interval = 0;
    scheduler.start();
    await advance(3 * 60 * MINUTE);
    expect(checks).toBe(0);

    interval = 30;
    await advance(DUE_POLL_MS);
    expect(checks).toBe(1);
  });

  test("a shorter interval set while running applies within a minute", async () => {
    scheduler.start();
    await advance(STARTUP_CHECK_DELAY_MS);
    expect(checks).toBe(1);

    interval = 5;
    await advance(5 * MINUTE + DUE_POLL_MS);
    expect(checks).toBe(2);
  });

  test("failures back off 1, 2, 4 minutes, and a success returns to the interval", async () => {
    results = [false, false, false, true];
    scheduler.start();
    await advance(STARTUP_CHECK_DELAY_MS);
    expect(checks).toBe(1);

    // Wake-ups fall a minute apart from 0:05: the second check is due a minute after the first,
    // the third two minutes after the second, the fourth four minutes after the third.
    await advance(MINUTE);
    expect(checks).toBe(2);
    await advance(MINUTE);
    expect(checks).toBe(2);
    await advance(MINUTE);
    expect(checks).toBe(3);
    await advance(3 * MINUTE);
    expect(checks).toBe(3);
    await advance(MINUTE);
    expect(checks).toBe(4);

    await advance(30 * MINUTE);
    expect(checks).toBe(4);
    await advance(31 * MINUTE);
    expect(checks).toBe(5);
  });

  test("backoff never waits longer than the interval", async () => {
    interval = 3;
    results = Array.from({ length: 10 }, () => false);
    scheduler.start();
    await advance(STARTUP_CHECK_DELAY_MS);
    await advance(30 * MINUTE);
    // 1 + 2 + 3 + 3 + … minutes (plus up to a wake-up each): far more than 30 / 60.
    expect(checks).toBeGreaterThanOrEqual(7);
  });

  test("a check that throws counts as a failure and never escapes", async () => {
    const throwing = createCheckScheduler({
      intervalMinutes: async () => 60,
      check: async () => {
        checks++;
        throw new Error("offline");
      },
    });
    throwing.start();
    await advance(STARTUP_CHECK_DELAY_MS);
    await advance(MINUTE + DUE_POLL_MS);
    expect(checks).toBe(2);
    throwing.stop();
  });

  test("a setting that cannot be read skips the wake-up", async () => {
    const broken = createCheckScheduler({
      intervalMinutes: async () => {
        throw new Error("database closed");
      },
      check: async () => {
        checks++;
        return true;
      },
    });
    broken.start();
    await advance(10 * MINUTE);
    expect(checks).toBe(0);
    broken.stop();
  });

  test("stop cancels every later check", async () => {
    scheduler.start();
    await advance(STARTUP_CHECK_DELAY_MS);
    scheduler.stop();
    await advance(5 * 60 * MINUTE);
    expect(checks).toBe(1);
  });

  test("a slow check is never run twice at once", async () => {
    let release = () => {};
    let running = 0;
    let most = 0;
    const slow = createCheckScheduler({
      intervalMinutes: async () => 1,
      check: () =>
        new Promise<boolean>((resolve) => {
          running++;
          most = Math.max(most, running);
          release = () => {
            running--;
            resolve(true);
          };
        }),
    });
    void slow.tick();
    void slow.tick();
    await flush();
    release();
    await flush();
    expect(most).toBe(1);
  });
});
