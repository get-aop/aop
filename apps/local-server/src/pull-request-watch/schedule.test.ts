import { describe, expect, test } from "bun:test";
import type { PollResult } from "./poll.ts";
import { afterPoll, blockedUntil, DEFAULT_TIMING, dueNow, type Timing } from "./schedule.ts";

const NOW = 1_000_000;
const exact: Timing = { ...DEFAULT_TIMING, jitter: 0 };
const middle = () => 0.5;

const unchanged: PollResult = { kind: "polled", changed: false, pending: false };
const changed: PollResult = { kind: "polled", changed: true, pending: false };
const failed: PollResult = { kind: "failed", message: "down", rateLimited: false };

const step = (result: PollResult, previous = dueNow(NOW)) =>
  afterPoll(previous, result, NOW, exact, middle);

describe("when the next look is due", () => {
  test("a pull request nobody has looked at is due at once", () => {
    expect(dueNow(NOW)).toEqual({ nextAt: NOW, unchanged: 0, failures: 0 });
  });

  test("something changing, or checks still running, is looked at again after the active wait", () => {
    expect(step(changed).nextAt).toBe(NOW + 30_000);
    expect(step({ kind: "polled", changed: false, pending: true }).nextAt).toBe(NOW + 30_000);
  });

  test("checks that keep running are looked at a little less often too, up to the pending wait", () => {
    const waits: number[] = [];
    let schedule = dueNow(NOW);
    const running: PollResult = { kind: "polled", changed: false, pending: true };
    for (let look = 0; look < 6; look += 1) {
      schedule = step(running, schedule);
      waits.push(schedule.nextAt - NOW);
    }

    expect(waits).toEqual([30_000, 60_000, 120_000, 120_000, 120_000, 120_000]);
    // Something changing brings the close pace back.
    expect(step(changed, schedule).nextAt).toBe(NOW + 30_000);
  });

  test("a fixed pace holds for checks that keep running too", () => {
    const fixed: Timing = { ...exact, activeMs: 1_500, quietMs: 1_500 };
    const running: PollResult = { kind: "polled", changed: false, pending: true };
    let schedule = dueNow(NOW);
    for (let look = 0; look < 5; look += 1) {
      schedule = afterPoll(schedule, running, NOW, fixed, middle);
      expect(schedule.nextAt - NOW).toBe(1_500);
    }
  });

  test("a pull request that stays as it is is looked at less and less often, up to the quiet wait", () => {
    const waits: number[] = [];
    let schedule = dueNow(NOW);
    for (let look = 0; look < 6; look += 1) {
      schedule = step(unchanged, schedule);
      waits.push(schedule.nextAt - NOW);
    }

    expect(waits).toEqual([60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    // Then something happens, and it is looked at closely again.
    expect(step(changed, schedule)).toEqual({ nextAt: NOW + 30_000, unchanged: 0, failures: 0 });
  });

  test("a look that failed waits twice as long each time, up to the backoff, and success forgets it", () => {
    const waits: number[] = [];
    let schedule = dueNow(NOW);
    for (let look = 0; look < 7; look += 1) {
      schedule = step(failed, schedule);
      waits.push(schedule.nextAt - NOW);
    }

    expect(waits).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
    expect(schedule.failures).toBe(7);
    expect(step(unchanged, schedule).failures).toBe(0);
  });

  test("a pull request that went away is treated as unchanged", () => {
    expect(step({ kind: "skipped" }).unchanged).toBe(1);
  });
});

describe("jitter", () => {
  test("spreads each wait by the share either way, so pull requests do not look in step", () => {
    const at = (random: number) =>
      afterPoll(dueNow(NOW), changed, NOW, DEFAULT_TIMING, () => random).nextAt - NOW;

    expect(at(0)).toBe(24_000);
    expect(at(0.5)).toBe(30_000);
    expect(at(1)).toBe(36_000);
    expect(blockedUntil(NOW, DEFAULT_TIMING, () => 0.5) - NOW).toBe(600_000);
  });
});
