import type { UsageTotals } from "@aop/common";

type Buckets = Pick<
  UsageTotals,
  "inputTokens" | "outputTokens" | "cacheWriteTokens" | "cacheReadTokens"
>;

export const totalTokens = (totals: Buckets): number =>
  totals.inputTokens + totals.outputTokens + totals.cacheWriteTokens + totals.cacheReadTokens;

/** How much of what the model was given came from the cache: cache reads over input, cache writes and cache reads. */
export const cacheReadShare = (totals: Buckets): { part: number; whole: number } => ({
  part: totals.cacheReadTokens,
  whole: totals.inputTokens + totals.cacheWriteTokens + totals.cacheReadTokens,
});

export type UsageWindowId = "all" | "24h" | "7d" | "30d";

const HOUR_MS = 3_600_000;

export const USAGE_WINDOWS: { id: UsageWindowId; label: string; hours: number | null }[] = [
  { id: "all", label: "All time", hours: null },
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
];

/**
 * Whole numbers that follow `weights` and add up to `target` exactly: each gets its rounded-down
 * share and the units left over go to the largest remainders. Rounding each row by itself would
 * leave a column that adds to 98% or to a cent under the total.
 */
export const apportion = (weights: readonly number[], target: number): number[] => {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0 || target <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight / sum) * target);
  const floors = exact.map(Math.floor);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const leftover = target - floors.reduce((acc, floor) => acc + floor, 0);
  for (const { index } of byRemainder.slice(0, Math.max(leftover, 0))) {
    floors[index] = (floors[index] ?? 0) + 1;
  }
  return floors;
};

/** Each part's whole percent of `whole`; parts that make up the whole add up to 100. */
export const apportionPercent = (parts: readonly number[], whole: number): number[] => {
  if (whole <= 0) return parts.map(() => 0);
  const covered = parts.reduce((acc, part) => acc + part, 0);
  return apportion(parts, Math.round((covered / whole) * 100));
};

/** Each cost in whole cents (null stays null), so the column adds up to the rounded sum of the costs. */
export const apportionCents = (costs: readonly (number | null)[]): (number | null)[] => {
  const present = costs.map((cost) => cost ?? 0);
  const cents = apportion(present, Math.round(present.reduce((acc, cost) => acc + cost, 0) * 100));
  return costs.map((cost, index) => (cost === null ? null : (cents[index] ?? 0)));
};

/** The instants a window covers as of `now`. A window that names no length is open on both sides. */
export const rangeOf = (
  id: UsageWindowId,
  now: number,
): { since: string | null; until: string | null } => {
  const hours = USAGE_WINDOWS.find((window) => window.id === id)?.hours ?? null;
  return {
    since: hours === null ? null : new Date(now - hours * HOUR_MS).toISOString(),
    until: null,
  };
};
