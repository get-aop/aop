import { z } from "zod";
import { CronError, type CronSpec, cronMatchesDay, parseCron } from "./cron.ts";
import { instantOfWallTime, nextDay, type WallTime, wallTimeAt, weekdayOf } from "./zoned-time.ts";

/**
 * When a routine runs. The friendly kinds are what a person picks in the form and what the
 * coordinator is asked for; `cron` is everything else. Every kind is read as a cron expression
 * on the host's wall clock (see `scheduleToCron`), so one engine finds every occurrence.
 */

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CRON_EXPRESSION_MAX = 200;

const TimeOfDaySchema = z
  .string()
  .regex(TIME_OF_DAY_PATTERN, { error: "Use a 24-hour time like 09:00" })
  .describe("24-hour wall-clock time on the host, HH:MM.");

const WeekdaySchema = z.number().int().min(0).max(6);

export const RoutineScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time: TimeOfDaySchema }),
  z.object({ kind: z.literal("weekdays"), time: TimeOfDaySchema }),
  z.object({
    kind: z.literal("weekly"),
    days: z
      .array(WeekdaySchema)
      .min(1, { error: "Pick at least one day" })
      .max(7)
      .describe("Days of the week, 0 = Sunday to 6 = Saturday."),
    time: TimeOfDaySchema,
  }),
  z.object({
    kind: z.literal("hourly"),
    every: z.number().int().min(1).max(24).describe("Run every N hours, counted from midnight."),
    minute: z.number().int().min(0).max(59).default(0).describe("Minutes past the hour."),
  }),
  z.object({
    kind: z.literal("cron"),
    expression: z
      .string()
      .trim()
      .min(1, { error: "Enter a cron expression" })
      .max(CRON_EXPRESSION_MAX)
      .superRefine((expression, ctx) => {
        const error = cronError(expression);
        if (error) ctx.addIssue({ code: "custom", message: error });
      })
      .describe("Five fields: minute hour day-of-month month day-of-week."),
  }),
]);
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;
export type RoutineScheduleKind = RoutineSchedule["kind"];

/** Why an expression is not one, or null when it parses. */
export const cronError = (expression: string): string | null => {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    if (error instanceof CronError) return error.message;
    throw error;
  }
};

export const scheduleToCron = (schedule: RoutineSchedule): string => {
  switch (schedule.kind) {
    case "daily":
      return `${minuteOf(schedule.time)} ${hourOf(schedule.time)} * * *`;
    case "weekdays":
      return `${minuteOf(schedule.time)} ${hourOf(schedule.time)} * * 1-5`;
    case "weekly":
      return `${minuteOf(schedule.time)} ${hourOf(schedule.time)} * * ${[...new Set(schedule.days)]
        .sort((a, b) => a - b)
        .join(",")}`;
    case "hourly":
      return schedule.every === 1
        ? `${schedule.minute} * * * *`
        : `${schedule.minute} */${schedule.every} * * *`;
    case "cron":
      return schedule.expression.trim();
  }
};

/**
 * The first run strictly after `after` (epoch ms), on the clock of `timeZone`, or null when the
 * schedule never runs again (a date like 31 February). Each wall-clock time runs once: an hour
 * DST repeats does not run twice, and one DST skips runs just after the jump.
 */
export const nextOccurrence = (
  schedule: RoutineSchedule,
  after: number,
  timeZone: string,
): number | null => findNext(parseCron(scheduleToCron(schedule)), after, timeZone);

/** The next `count` runs after `after`, for a preview. */
export const nextOccurrences = (
  schedule: RoutineSchedule,
  after: number,
  timeZone: string,
  count: number,
): number[] => {
  const spec = parseCron(scheduleToCron(schedule));
  const found: number[] = [];
  let cursor = after;
  while (found.length < count) {
    const next = findNext(spec, cursor, timeZone);
    if (next === null) break;
    found.push(next);
    cursor = next;
  }
  return found;
};

/**
 * The shortest wall-clock gap, in minutes, between two runs on days the schedule runs every
 * day. The host refuses a routine that runs more often than its minimum interval.
 */
export const shortestGapMinutes = (schedule: RoutineSchedule): number => {
  const spec = parseCron(scheduleToCron(schedule));
  const times = spec.hours.flatMap((hour) => spec.minutes.map((minute) => hour * 60 + minute));
  let shortest = DAY_MINUTES;
  for (let index = 1; index < times.length; index += 1) {
    shortest = Math.min(shortest, (times[index] as number) - (times[index - 1] as number));
  }
  // The last run of one day and the first of the next, when the schedule runs on both.
  const wrap = (times[0] as number) + DAY_MINUTES - (times[times.length - 1] as number);
  return Math.min(shortest, wrap);
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The schedule in plain words: "Weekdays at 09:00", "Every 3 hours", "Every Friday at 17:00". */
export const describeSchedule = (schedule: RoutineSchedule): string => {
  switch (schedule.kind) {
    case "daily":
      return `Every day at ${schedule.time}`;
    case "weekdays":
      return `Weekdays at ${schedule.time}`;
    case "weekly":
      return describeWeekly(schedule.days, schedule.time);
    case "hourly":
      return describeHourly(schedule.every, schedule.minute);
    case "cron":
      return `Custom: ${schedule.expression.trim()}`;
  }
};

const DAY_MINUTES = 24 * 60;
// Far enough for any day a valid expression names (29 February comes within 8 years).
const SEARCH_DAYS = 366 * 8;
// A time in a DST gap moves on by the gap, at most a few hours; candidates past this cannot win.
const GAP_SLACK_MINUTES = 180;

const findNext = (spec: CronSpec, after: number, timeZone: string): number | null => {
  const start = wallTimeAt(Math.floor(after / 60_000) * 60_000 + 60_000, timeZone);
  let day: Pick<WallTime, "year" | "month" | "day"> = start;
  for (let index = 0; index < SEARCH_DAYS; index += 1) {
    if (cronMatchesDay(spec, { ...day, weekday: weekdayOf(day) })) {
      const found = earliestOnDay(spec, day, index === 0 ? start : null, after, timeZone);
      if (found !== null) return found;
    }
    day = nextDay(day);
  }
  return null;
};

// The earliest instant after `after` among one day's times; `from` skips the times before it.
const earliestOnDay = (
  spec: CronSpec,
  day: Pick<WallTime, "year" | "month" | "day">,
  from: WallTime | null,
  after: number,
  timeZone: string,
): number | null => {
  const fromMinute = from ? from.hour * 60 + from.minute : 0;
  let best: number | null = null;
  let bestMinute = 0;
  for (const hour of spec.hours) {
    for (const minute of spec.minutes) {
      const minuteOfDay = hour * 60 + minute;
      if (minuteOfDay < fromMinute) continue;
      if (best !== null && minuteOfDay > bestMinute + GAP_SLACK_MINUTES) return best;
      const instant = instantOfWallTime({ ...day, hour, minute }, timeZone);
      if (instant > after && (best === null || instant < best)) {
        best = instant;
        bestMinute = minuteOfDay;
      }
    }
  }
  return best;
};

const hourOf = (time: string): number => Number(time.slice(0, 2));
const minuteOf = (time: string): number => Number(time.slice(3, 5));

const describeWeekly = (days: readonly number[], time: string): string => {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 7) return `Every day at ${time}`;
  if (unique.join(",") === "1,2,3,4,5") return `Weekdays at ${time}`;
  if (unique.join(",") === "0,6") return `Weekends at ${time}`;
  const names = unique.map((day) => WEEKDAY_NAMES[day] as string);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`;
  return `Every ${list} at ${time}`;
};

const describeHourly = (every: number, minute: number): string => {
  const past = minute === 0 ? "" : ` at ${String(minute).padStart(2, "0")} past`;
  if (every === 1) return `Every hour${past}`;
  if (every === 24) return `Every day at 00:${String(minute).padStart(2, "0")}`;
  return `Every ${every} hours${past}`;
};
