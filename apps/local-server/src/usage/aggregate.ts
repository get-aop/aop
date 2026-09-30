import type { ModelUsage, ProjectUsageThread, UsageTotals } from "@aop/common";
import type { UsageRecord } from "./repository.ts";

// Sums are taken here, over the run x model records, and not in SQL: a run that used two
// models is two records, so a run count has to be a count of distinct runs.

export const totalsOf = (records: readonly UsageRecord[]): UsageTotals => {
  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: null,
    runs: new Set(records.map((record) => record.runId)).size,
  };
  for (const record of records) {
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheWriteTokens += record.cacheWriteTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    if (record.costUsd !== null) totals.costUsd = (totals.costUsd ?? 0) + record.costUsd;
  }
  if (totals.costUsd !== null) totals.costUsd = roundToMicroDollars(totals.costUsd);
  return totals;
};

/** One entry per provider and model, the one with the most tokens first. */
export const byModel = (records: readonly UsageRecord[]): ModelUsage[] =>
  largestFirst(
    groupBy(records, (record) => `${record.provider}/${record.model}`).map((group) => ({
      provider: group.head.provider,
      model: group.head.model,
      ...totalsOf(group.items),
    })),
    (entry) => `${entry.provider}/${entry.model}`,
  );

/** One entry per session, the one with the most tokens first. */
export const byThread = (records: readonly UsageRecord[]): ProjectUsageThread[] =>
  largestFirst(
    groupBy(records, (record) => record.sessionId).flatMap(({ head, items }) =>
      head.sessionKind === null
        ? []
        : [
            {
              threadId: head.sessionId,
              kind: head.sessionKind,
              title: head.sessionTitle,
              models: byModel(items).map((entry) => entry.model),
              ...totalsOf(items),
            },
          ],
    ),
    (entry) => entry.threadId,
  );

// Adding floats leaves noise (0.22875 + 0.00825 is 0.23700000000000002); providers report costs
// to a few decimals, so a millionth of a dollar keeps every real digit.
const roundToMicroDollars = (usd: number): number => Math.round(usd * 1_000_000) / 1_000_000;

interface Group<T> {
  head: T;
  items: T[];
}

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Group<T>[] => {
  const groups = new Map<string, Group<T>>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { head: item, items: [item] });
  }
  return [...groups.values()];
};

const tokensOf = (totals: UsageTotals): number =>
  totals.inputTokens + totals.outputTokens + totals.cacheWriteTokens + totals.cacheReadTokens;

// Ties break on the key so the order does not depend on which run finished first.
const largestFirst = <T extends UsageTotals>(entries: T[], keyOf: (entry: T) => string): T[] =>
  entries.sort((a, b) => tokensOf(b) - tokensOf(a) || keyOf(a).localeCompare(keyOf(b)));
