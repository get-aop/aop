/** "Sep 30, 2026, 2:05 PM": a date and time, since a note's age is the point of the label. */
export const formatUpdated = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Exact up to a million, then compact (3.4M): cache reads add up to hundreds of millions. */
export const formatTokens = (count: number): string =>
  count < 1_000_000 ? count.toLocaleString("en-US") : COMPACT.format(count);

/** Dollars, with cents; a sub-cent total still reads as a cost rather than as zero. */
export const formatCost = (usd: number): string =>
  usd > 0 && usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;

/** A percent `apportionPercent` worked out; a part that is more than nothing never reads as 0%. */
export const formatWholePercent = (percent: number, part: number): string =>
  part > 0 && percent === 0 ? "<1%" : `${percent}%`;

/** Cents `apportionCents` worked out, as dollars; a cost that is more than nothing never reads as $0.00. */
export const formatWholeCents = (cents: number, usd: number): string =>
  usd > 0 && cents === 0 ? "<$0.01" : `$${(cents / 100).toFixed(2)}`;

/** A share of a whole as a percent, "0%" for an empty whole; below one percent it says so. */
export const formatShare = (part: number, whole: number): string => {
  if (whole <= 0 || part <= 0) return "0%";
  const percent = (part / whole) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
};
