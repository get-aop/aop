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
