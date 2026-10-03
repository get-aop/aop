const shortTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const monthDay = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const parse = (iso: string): Date | null => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "9:41 AM": the time shown under a message. */
export const formatShortTimestamp = (iso: string): string => {
  const date = parse(iso);
  return date ? shortTime.format(date) : "";
};

/** "9:41 AM, Wed, September 30, 2026": what the time's tooltip adds. */
export const formatTimestampTooltip = (iso: string): string => {
  const date = parse(iso);
  return date ? `${shortTime.format(date)}, ${longDate.format(date)}` : "";
};

/**
 * "Today", "Yesterday" or a date when `iso` starts a new calendar day after `previousIso`
 * (or is the first message); null when it is the same day as the message before it.
 */
export const dayMarkerLabel = (
  iso: string,
  previousIso: string | null,
  now: Date = new Date(),
): string | null => {
  const date = parse(iso);
  if (!date) return null;
  const previous = previousIso ? parse(previousIso) : null;
  if (previous && sameDay(date, previous)) return null;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return (date.getFullYear() === now.getFullYear() ? monthDay : fullDate).format(date);
};

/** "12s", "3m 05s": how long the coordinator has been working on a message. */
export { formatElapsed } from "@aop/common";
