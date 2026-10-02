import { describe, expect, test } from "bun:test";
import { CronError, parseCron } from "./cron.ts";
import { RoutineInputSchema, RoutinePatchSchema } from "./routine.ts";
import {
  cronError,
  describeSchedule,
  nextOccurrence,
  nextOccurrences,
  type RoutineSchedule,
  RoutineScheduleSchema,
  scheduleToCron,
  shortestGapMinutes,
} from "./schedule.ts";
import { instantOfWallTime, wallTimeAt } from "./zoned-time.ts";

const NEW_YORK = "America/New_York";
const LONDON = "Europe/London";
const at = (iso: string): number => Date.parse(iso);
const iso = (instant: number | null): string | null =>
  instant === null ? null : new Date(instant).toISOString();

describe("parseCron", () => {
  test("reads values, ranges, steps, lists and names", () => {
    const spec = parseCron("*/15 9-17/4 1,15 JAN-MAR mon-fri");
    expect(spec.minutes).toEqual([0, 15, 30, 45]);
    expect(spec.hours).toEqual([9, 13, 17]);
    expect([...spec.daysOfMonth].sort((a, b) => a - b)).toEqual([1, 15]);
    expect([...spec.months].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect([...spec.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(spec.dayOfMonthRestricted).toBe(true);
    expect(spec.dayOfWeekRestricted).toBe(true);
  });

  test("a start with a step runs to the field's end, and 7 is Sunday", () => {
    expect(parseCron("10/20 * * * 7").minutes).toEqual([10, 30, 50]);
    expect([...parseCron("0 0 * * 7").daysOfWeek]).toEqual([0]);
  });

  test("accepts the shorthands", () => {
    expect(parseCron("@hourly").minutes).toEqual([0]);
    expect(parseCron("@daily").hours).toEqual([0]);
  });

  test.each([
    ["* * * *", "5 fields"],
    ["60 * * * *", "Minute: 60 is outside 0-59"],
    ["* 24 * * *", "Hour: 24 is outside 0-23"],
    ["* * 0 * *", "Day of month: 0 is outside 1-31"],
    ["* * * 13 *", "Month: 13 is outside 1-12"],
    ["* * * * 8", "Day of week: 8 is outside 0-7"],
    ["5-1 * * * *", "runs backwards"],
    ["*/0 * * * *", "a step must be 1 or more"],
    ["a * * * *", 'Minute: "a" is not a value'],
    ["1,,2 * * * *", "an empty item"],
  ])("refuses %p with a reason", (expression, reason) => {
    expect(() => parseCron(expression)).toThrow(CronError);
    expect(cronError(expression)).toContain(reason);
  });
});

describe("the friendly schedules", () => {
  test.each<[RoutineSchedule, string, string]>([
    [{ kind: "daily", time: "09:00" }, "0 9 * * *", "Every day at 09:00"],
    [{ kind: "weekdays", time: "08:30" }, "30 8 * * 1-5", "Weekdays at 08:30"],
    [{ kind: "weekly", days: [5], time: "17:00" }, "0 17 * * 5", "Every Friday at 17:00"],
    [
      { kind: "weekly", days: [5, 1, 1], time: "09:15" },
      "15 9 * * 1,5",
      "Every Monday and Friday at 09:15",
    ],
    [{ kind: "weekly", days: [0, 6], time: "10:00" }, "0 10 * * 0,6", "Weekends at 10:00"],
    [{ kind: "hourly", every: 1, minute: 0 }, "0 * * * *", "Every hour"],
    [{ kind: "hourly", every: 3, minute: 15 }, "15 */3 * * *", "Every 3 hours at 15 past"],
    [{ kind: "cron", expression: " 0 9 1 * * " }, "0 9 1 * *", "Custom: 0 9 1 * *"],
  ])("%p is %p, said as %p", (schedule, cron, words) => {
    expect(scheduleToCron(schedule)).toBe(cron);
    expect(describeSchedule(schedule)).toBe(words);
  });

  test("the schema refuses a bad time, no days and a bad expression", () => {
    expect(RoutineScheduleSchema.safeParse({ kind: "daily", time: "9:00" }).success).toBe(false);
    expect(RoutineScheduleSchema.safeParse({ kind: "daily", time: "24:00" }).success).toBe(false);
    expect(
      RoutineScheduleSchema.safeParse({ kind: "weekly", days: [], time: "09:00" }).success,
    ).toBe(false);
    const bad = RoutineScheduleSchema.safeParse({ kind: "cron", expression: "61 * * * *" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("Minute: 61 is outside 0-59");
  });

  test("the shortest gap between runs", () => {
    expect(shortestGapMinutes({ kind: "daily", time: "09:00" })).toBe(1440);
    expect(shortestGapMinutes({ kind: "hourly", every: 1, minute: 0 })).toBe(60);
    expect(shortestGapMinutes({ kind: "cron", expression: "*/5 * * * *" })).toBe(5);
    expect(shortestGapMinutes({ kind: "cron", expression: "0,10 9 * * *" })).toBe(10);
    // 23:55 one day and 00:05 the next.
    expect(shortestGapMinutes({ kind: "cron", expression: "5,55 0,23 * * *" })).toBe(10);
  });
});

describe("nextOccurrence", () => {
  test("daily: later today, or tomorrow once the time has passed", () => {
    const daily: RoutineSchedule = { kind: "daily", time: "09:00" };
    expect(iso(nextOccurrence(daily, at("2026-03-02T13:59:00Z"), NEW_YORK))).toBe(
      "2026-03-02T14:00:00.000Z",
    );
    // Exactly at the time is not after it.
    expect(iso(nextOccurrence(daily, at("2026-03-02T14:00:00Z"), NEW_YORK))).toBe(
      "2026-03-03T14:00:00.000Z",
    );
  });

  test("weekdays skip the weekend", () => {
    // Friday 2026-03-06 10:00 New York.
    expect(
      iso(
        nextOccurrence({ kind: "weekdays", time: "09:00" }, at("2026-03-06T15:00:00Z"), NEW_YORK),
      ),
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  test("weekly on several days", () => {
    const runs = nextOccurrences(
      { kind: "weekly", days: [1, 4], time: "17:30" },
      at("2026-06-01T00:00:00Z"),
      LONDON,
      3,
    ).map((instant) => new Date(instant).toISOString());
    expect(runs).toEqual([
      "2026-06-01T16:30:00.000Z",
      "2026-06-04T16:30:00.000Z",
      "2026-06-08T16:30:00.000Z",
    ]);
  });

  test("every N hours counts from midnight on the wall clock", () => {
    const runs = nextOccurrences(
      { kind: "hourly", every: 6, minute: 0 },
      at("2026-06-01T05:00:00Z"),
      "UTC",
      4,
    ).map((instant) => new Date(instant).toISOString());
    expect(runs).toEqual([
      "2026-06-01T06:00:00.000Z",
      "2026-06-01T12:00:00.000Z",
      "2026-06-01T18:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
    ]);
  });

  test("a cron day of month and weekday match either one", () => {
    // The 13th, or any Friday.
    const runs = nextOccurrences(
      { kind: "cron", expression: "0 12 13 * 5" },
      at("2026-02-01T00:00:00Z"),
      "UTC",
      3,
    ).map((instant) => new Date(instant).toISOString().slice(0, 10));
    expect(runs).toEqual(["2026-02-06", "2026-02-13", "2026-02-20"]);
  });

  test("a date that never comes is null", () => {
    expect(
      nextOccurrence({ kind: "cron", expression: "0 0 31 2 *" }, at("2026-01-01T00:00:00Z"), "UTC"),
    ).toBeNull();
  });

  test("29 February is found years ahead", () => {
    expect(
      iso(
        nextOccurrence(
          { kind: "cron", expression: "0 0 29 2 *" },
          at("2026-03-01T00:00:00Z"),
          "UTC",
        ),
      ),
    ).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("DST", () => {
  // New York springs forward at 02:00 on 2026-03-08 (EST -5 to EDT -4) and falls back at 02:00
  // on 2026-11-01 (EDT to EST).

  test("a daily time keeps its wall-clock hour across both changes", () => {
    const daily: RoutineSchedule = { kind: "daily", time: "09:00" };
    const spring = nextOccurrences(daily, at("2026-03-07T00:00:00Z"), NEW_YORK, 2).map(iso);
    expect(spring).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
    const autumn = nextOccurrences(daily, at("2026-10-31T00:00:00Z"), NEW_YORK, 2).map(iso);
    expect(autumn).toEqual(["2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z"]);
  });

  test("a time in the spring-forward gap runs just after the jump, once", () => {
    const daily: RoutineSchedule = { kind: "daily", time: "02:30" };
    const runs = nextOccurrences(daily, at("2026-03-07T12:00:00Z"), NEW_YORK, 3).map(iso);
    expect(runs).toEqual([
      // 02:30 does not exist on the 8th: it runs at 03:30 EDT, one hour of gap on.
      "2026-03-08T07:30:00.000Z",
      // 02:30 EDT on the 9th.
      "2026-03-09T06:30:00.000Z",
      "2026-03-10T06:30:00.000Z",
    ]);
    expect(wallTimeAt(at("2026-03-08T07:30:00Z"), NEW_YORK)).toMatchObject({ day: 8, hour: 3 });
  });

  test("hourly runs skip the lost hour and do not repeat the doubled one", () => {
    const hourly: RoutineSchedule = { kind: "hourly", every: 1, minute: 0 };
    const spring = nextOccurrences(hourly, at("2026-03-08T05:30:00Z"), NEW_YORK, 3).map((instant) =>
      wallTimeAt(instant, NEW_YORK),
    );
    // 01:00 EST, then 03:00 EDT (02:00 does not exist and lands on 03:00, run once), then 04:00.
    expect(spring.map((wall) => wall.hour)).toEqual([1, 3, 4]);

    const autumn = nextOccurrences(hourly, at("2026-11-01T04:30:00Z"), NEW_YORK, 3).map(iso);
    expect(autumn).toEqual([
      // 01:00 EDT, then 02:00 EST: the repeated 01:00 EST does not run a second time.
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ]);
  });

  test("a time in the repeated hour runs at its first showing", () => {
    const daily: RoutineSchedule = { kind: "daily", time: "01:30" };
    expect(iso(nextOccurrence(daily, at("2026-11-01T04:00:00Z"), NEW_YORK))).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    // From inside the second 01:00-02:00 the day's run has passed: tomorrow.
    expect(iso(nextOccurrence(daily, at("2026-11-01T06:10:00Z"), NEW_YORK))).toBe(
      "2026-11-02T06:30:00.000Z",
    );
  });

  test("instantOfWallTime in London's gap and overlap", () => {
    // 2026-03-29 01:30 does not exist in London; 2026-10-25 01:30 happens twice.
    expect(
      iso(instantOfWallTime({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LONDON)),
    ).toBe("2026-03-29T01:30:00.000Z");
    expect(
      iso(instantOfWallTime({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LONDON)),
    ).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("routine input", () => {
  test("defaults a new routine to a thread, enabled, skipping missed runs", () => {
    const parsed = RoutineInputSchema.parse({
      name: " Morning digest ",
      prompt: "Summarize new issues and PRs",
      schedule: { kind: "weekdays", time: "09:00" },
    });
    expect(parsed).toEqual({
      name: "Morning digest",
      prompt: "Summarize new issues and PRs",
      schedule: { kind: "weekdays", time: "09:00" },
      target: "thread",
      repoId: null,
      model: null,
      effort: null,
      enabled: true,
      catchUp: "skip",
    });
  });

  test("a patch must change something", () => {
    expect(RoutinePatchSchema.safeParse({}).success).toBe(false);
    expect(RoutinePatchSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});
