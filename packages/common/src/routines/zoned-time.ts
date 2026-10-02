/**
 * Wall-clock time in a named time zone, from `Intl` alone. A schedule says "9:00", meaning the
 * host's clock, so occurrences are found on the wall clock and turned into instants here.
 */

export interface WallTime {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
};

/** The zone this process runs in: the host's own clock. */
export const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** What a clock in `timeZone` reads at `instant` (to the minute). */
export const wallTimeAt = (instant: number, timeZone: string): WallTime => {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 0,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
  };
};

/** 0 is Sunday. A calendar fact, the same in every zone. */
export const weekdayOf = (wall: Pick<WallTime, "year" | "month" | "day">): number =>
  new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();

/** The calendar day after `wall`'s. */
export const nextDay = (wall: Pick<WallTime, "year" | "month" | "day">) => {
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + DAY_MS);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
};

/**
 * The instant a clock in `timeZone` reads `wall`. A time the clock shows twice (the hour
 * repeated when DST ends) is its first showing; a time it skips (the hour lost when DST
 * starts) is moved on by the length of the gap, so 02:30 on a spring-forward night is 03:30.
 */
export const instantOfWallTime = (wall: WallTime, timeZone: string): number => {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const before = offsetAt(asUtc - DAY_MS, timeZone);
  const after = offsetAt(asUtc + DAY_MS, timeZone);
  const matches = [...new Set([before, after])]
    .map((offset) => asUtc - offset)
    .filter((instant) => sameWallTime(wallTimeAt(instant, timeZone), wall))
    .sort((a, b) => a - b);
  // No offset shows this time: it is in the gap, and the clock before the gap says how far on.
  return matches[0] ?? asUtc - before;
};

/** How far the zone's clock is ahead of UTC at `instant`, in ms. */
const offsetAt = (instant: number, timeZone: string): number => {
  const floored = Math.floor(instant / MINUTE_MS) * MINUTE_MS;
  const wall = wallTimeAt(floored, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - floored;
};

const sameWallTime = (a: WallTime, b: WallTime): boolean =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;
