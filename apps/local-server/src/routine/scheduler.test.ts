import { describe, expect, test } from "bun:test";
import type { RoutineRunner } from "./runner.ts";
import { createRoutineScheduler, MAX_SLEEP_MS, type TimerApi } from "./scheduler.ts";
import { createTestClock } from "./test-utils.ts";

/** Timers a test fires by hand; it records every delay the scheduler asked for. */
const fakeTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  const api: TimerApi = {
    setTimeout: (run, ms) => {
      const id = next++;
      pending.set(id, { run, ms });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fireAll = () => {
    const due = [...pending.values()];
    pending.clear();
    for (const timer of due) timer.run();
  };
  return { api, pending, fireAll, delays: () => [...pending.values()].map((t) => t.ms) };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeRunner = () => {
  const calls: string[] = [];
  let release: (() => void) | null = null;
  const runner: RoutineRunner = {
    processDue: async () => {
      calls.push("pass");
      if (release === null) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    runNow: async () => {
      throw new Error("not used");
    },
    isBusy: async () => false,
    recover: async () => {
      calls.push("recover");
    },
    nextRunAfterNow: () => null,
  };
  return {
    runner,
    calls,
    /** Makes the next pass hang until `finish` is called. */
    hold: () => {
      release = () => {};
    },
    finish: () => {
      const done = release;
      release = null;
      done?.();
    },
  };
};

describe("the routine scheduler", () => {
  test("recovers, runs a pass at start, then sleeps until the soonest next run", async () => {
    const clock = createTestClock("2026-06-01T08:59:30.000Z");
    const timers = fakeTimers();
    const { runner, calls } = fakeRunner();
    const scheduler = createRoutineScheduler(
      runner,
      { earliestNextRun: async () => "2026-06-01T09:00:00.000Z" },
      clock,
      timers.api,
    );

    await scheduler.start();
    await flush();

    expect(calls).toEqual(["recover", "pass"]);
    expect(timers.delays()).toEqual([30_000]);
    await scheduler.stop();
  });

  test("never sleeps longer than a minute, and fires at once for a run already due", async () => {
    const clock = createTestClock("2026-06-01T08:00:00.000Z");
    let earliest: string | null = null;
    const timers = fakeTimers();
    const { runner } = fakeRunner();
    const scheduler = createRoutineScheduler(
      runner,
      { earliestNextRun: async () => earliest },
      clock,
      timers.api,
    );
    await scheduler.start();
    await flush();
    expect(timers.delays()).toEqual([MAX_SLEEP_MS]);

    earliest = "2026-06-02T08:00:00.000Z";
    timers.fireAll();
    await flush();
    expect(timers.delays()).toEqual([MAX_SLEEP_MS]);

    earliest = "2026-06-01T07:00:00.000Z";
    timers.fireAll();
    await flush();
    expect(timers.delays()).toEqual([0]);
    await scheduler.stop();
  });

  test("a poke during a pass runs one more pass after it, never two at once", async () => {
    const clock = createTestClock("2026-06-01T08:00:00.000Z");
    const timers = fakeTimers();
    const fake = fakeRunner();
    const scheduler = createRoutineScheduler(
      fake.runner,
      { earliestNextRun: async () => null },
      clock,
      timers.api,
    );
    fake.hold();
    await scheduler.start();
    expect(fake.calls).toEqual(["recover", "pass"]);

    scheduler.poke();
    scheduler.poke();
    expect(fake.calls).toEqual(["recover", "pass"]);

    fake.finish();
    await flush();
    await flush();
    expect(fake.calls).toEqual(["recover", "pass", "pass"]);
    await scheduler.stop();
  });

  test("stopped, it arms no timer and a poke does nothing", async () => {
    const clock = createTestClock("2026-06-01T08:00:00.000Z");
    const timers = fakeTimers();
    const fake = fakeRunner();
    const scheduler = createRoutineScheduler(
      fake.runner,
      { earliestNextRun: async () => null },
      clock,
      timers.api,
    );
    await scheduler.start();
    await flush();
    await scheduler.stop();
    expect(timers.pending.size).toBe(0);

    scheduler.poke();
    await flush();
    expect(fake.calls).toEqual(["recover", "pass"]);
  });
});
