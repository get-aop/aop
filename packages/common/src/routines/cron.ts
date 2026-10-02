/**
 * Five-field cron expressions (minute hour day-of-month month day-of-week), as `crontab(5)`
 * reads them: `*`, single values, ranges, steps (`*\/15`, `1-5/2`, `10/5`) and comma lists, with
 * month and weekday names (`JAN`, `MON`) and 7 as Sunday. When both day fields are restricted a
 * day matches either one, as in Vixie cron. The `@hourly`-style shorthands are accepted too.
 */

export interface CronSpec {
  minutes: readonly number[];
  hours: readonly number[];
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** 0 is Sunday; a 7 in the expression is folded into 0. */
  daysOfWeek: ReadonlySet<number>;
  /** Whether each day field was anything but `*`; decides how the two combine. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

export class CronError extends Error {}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const SHORTHANDS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

interface FieldRule {
  label: string;
  min: number;
  max: number;
  /** Names accepted for the field's values, from `min` up. */
  names?: readonly string[];
}

const FIELDS: readonly FieldRule[] = [
  { label: "Minute", min: 0, max: 59 },
  { label: "Hour", min: 0, max: 23 },
  { label: "Day of month", min: 1, max: 31 },
  { label: "Month", min: 1, max: 12, names: MONTH_NAMES },
  { label: "Day of week", min: 0, max: 7, names: DAY_NAMES },
];

/** Parses an expression or throws `CronError` with a sentence a person can act on. */
export const parseCron = (expression: string): CronSpec => {
  const trimmed = expression.trim();
  const expanded = SHORTHANDS[trimmed.toLowerCase()] ?? trimmed;
  const parts = expanded.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    throw new CronError(
      `A cron expression has 5 fields (minute hour day month weekday); this has ${parts.length}`,
    );
  }
  const [minutes, hours, days, months, weekdays] = parts.map((part, index) =>
    parseField(part, FIELDS[index] as FieldRule),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    minutes: [...minutes].sort((a, b) => a - b),
    hours: [...hours].sort((a, b) => a - b),
    daysOfMonth: days,
    months,
    daysOfWeek: weekdays,
    dayOfMonthRestricted: parts[2] !== "*",
    dayOfWeekRestricted: parts[4] !== "*",
  };
};

/** Whether a calendar day can hold a run: its month, then its day of month and weekday. */
export const cronMatchesDay = (
  spec: CronSpec,
  day: { month: number; day: number; weekday: number },
): boolean => {
  if (!spec.months.has(day.month)) return false;
  const byDate = spec.daysOfMonth.has(day.day);
  const byWeekday = spec.daysOfWeek.has(day.weekday);
  if (spec.dayOfMonthRestricted && spec.dayOfWeekRestricted) return byDate || byWeekday;
  return byDate && byWeekday;
};

const parseField = (field: string, rule: FieldRule): Set<number> => {
  const values = new Set<number>();
  for (const item of field.split(",")) {
    if (item === "") throw new CronError(`${rule.label}: an empty item in "${field}"`);
    for (const value of parseItem(item, rule)) values.add(value);
  }
  return values;
};

const parseItem = (item: string, rule: FieldRule): number[] => {
  const [range, stepText, extra] = item.split("/");
  if (extra !== undefined || range === undefined || range === "") {
    throw new CronError(`${rule.label}: "${item}" is not a value, range or step`);
  }
  const step = stepText === undefined ? 1 : parseNumber(stepText, rule, "step");
  if (step < 1) throw new CronError(`${rule.label}: a step must be 1 or more`);
  const [from, to] = parseRange(range, rule, stepText !== undefined);
  if (from > to) throw new CronError(`${rule.label}: the range ${range} runs backwards`);
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
};

// `a/n` means from a to the field's end, every n.
const parseRange = (range: string, rule: FieldRule, stepped: boolean): [number, number] => {
  if (range === "*") return [rule.min, rule.max];
  const [fromText, toText, extra] = range.split("-");
  if (extra !== undefined || fromText === undefined) {
    throw new CronError(`${rule.label}: "${range}" is not a range`);
  }
  const from = parseValue(fromText, rule);
  if (toText === undefined) return [from, stepped ? rule.max : from];
  return [from, parseValue(toText, rule)];
};

const parseValue = (text: string, rule: FieldRule): number => {
  const named = rule.names?.indexOf(text.toUpperCase()) ?? -1;
  // Month names start at 1, weekday names at 0: both are the field's minimum.
  const value = named >= 0 ? named + rule.min : parseNumber(text, rule, "value");
  if (value < rule.min || value > rule.max) {
    throw new CronError(`${rule.label}: ${text} is outside ${rule.min}-${rule.max}`);
  }
  return value;
};

const parseNumber = (text: string, rule: FieldRule, what: string): number => {
  if (!/^\d+$/.test(text)) throw new CronError(`${rule.label}: "${text}" is not a ${what}`);
  return Number(text);
};
