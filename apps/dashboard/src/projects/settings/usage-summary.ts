import { type CodeChanges, formatRuntimeModelLabel, type ProjectUsage } from "@aop/common";
import { formatAgo } from "../selectors";
import {
  formatCost,
  formatShare,
  formatTokens,
  formatWholeCents,
  formatWholePercent,
} from "./format";
import {
  THREAD_SORTS,
  type ThreadRow,
  type ThreadSort,
  totalTokens,
  USAGE_PARTS,
} from "./usage-math";

/** One figure of the headline, as the screen shows it and as the copied summary says it. */
export interface HeadlineFigure {
  id: "threads" | "tokens" | "cache-hit" | "code-changes" | "coordinator" | "cost";
  label: string;
  value: string;
}

/**
 * The project's headline figures. The coordinator's share is its row's apportioned share, so the
 * headline and the list never disagree by a rounding point.
 */
export const headlineOf = (usage: ProjectUsage, rows: readonly ThreadRow[]): HeadlineFigure[] => {
  const { totals } = usage;
  const coordinator = rows.filter((row) => row.thread.kind === "coordinator");
  const coordinatorShare = coordinator.reduce((sum, row) => sum + row.share, 0);
  const coordinatorTokens = coordinator.reduce((sum, row) => sum + row.tokens, 0);
  const cacheWhole = totals.inputTokens + totals.cacheWriteTokens + totals.cacheReadTokens;
  return [
    {
      id: "threads",
      label: "Threads",
      value: String(rows.filter((row) => row.thread.kind === "thread").length),
    },
    { id: "tokens", label: "Tokens", value: formatTokens(totalTokens(totals)) },
    {
      id: "cache-hit",
      label: "Cache hit",
      value: cacheWhole === 0 ? "—" : formatShare(totals.cacheReadTokens, cacheWhole),
    },
    { id: "code-changes", label: "Code changes", value: formatCodeChanges(usage.codeChanges) },
    {
      id: "coordinator",
      label: "Coordinator",
      value: formatWholePercent(coordinatorShare, coordinatorTokens),
    },
    {
      id: "cost",
      label: "Cost",
      value: totals.costUsd === null ? "Not reported" : formatCost(totals.costUsd),
    },
  ];
};

/** "+120 −30", or a dash when the runs changed no line. */
export const formatCodeChanges = ({ additions, deletions }: CodeChanges): string =>
  additions === 0 && deletions === 0
    ? "—"
    : `+${additions.toLocaleString("en-US")} −${deletions.toLocaleString("en-US")}`;

/** "89%", "<1%" for a little, or a dash for a thread the model was given nothing in. */
export const formatCacheHit = (cacheHit: number | null): string => {
  if (cacheHit === null) return "—";
  const percent = Math.round(cacheHit * 100);
  return cacheHit > 0 && percent === 0 ? "<1%" : `${percent}%`;
};

/** "Opus 5", or "Opus 5 +1" for a thread that used two models. */
export const formatThreadModels = (models: readonly string[]): string => {
  const [first, ...rest] = models;
  if (!first) return "";
  return `${formatRuntimeModelLabel(first)}${rest.length > 0 ? ` +${rest.length}` : ""}`;
};

/** What the copy button puts on the clipboard: the screen in plain text, rows in their shown order. */
export const usageSummary = ({
  projectName,
  windowLabel,
  usage,
  rows,
  sort,
  now,
}: {
  projectName: string;
  windowLabel: string;
  usage: ProjectUsage;
  rows: readonly ThreadRow[];
  sort: ThreadSort;
  now: number;
}): string => {
  const headline = headlineOf(usage, rows)
    .map((figure) => `${figure.label} ${figure.value}`)
    .join(" · ");
  const parts = [
    ...USAGE_PARTS.map((part) => `${part.label} ${formatTokens(usage.totals[part.key])}`),
    `Runs ${usage.totals.runs}`,
  ].join(" · ");
  const sortLabel = THREAD_SORTS.find((option) => option.id === sort)?.label ?? sort;
  return [
    `${projectName} usage, ${windowLabel.toLowerCase()}`,
    headline,
    parts,
    "",
    `Threads, by ${sortLabel.toLowerCase()}:`,
    ...rows.map((row) => `- ${threadLine(row, now)}`),
  ].join("\n");
};

const threadLine = (row: ThreadRow, now: number): string => {
  const { thread } = row;
  const name = thread.kind === "coordinator" ? "Coordinator" : thread.title;
  const when = [formatThreadModels(thread.models), formatAgo(thread.lastRunAt, now)]
    .filter(Boolean)
    .join(", ");
  const figures = [
    `${formatTokens(row.tokens)} tokens`,
    `${formatCacheHit(row.cacheHit)} cache hit`,
    `${formatWholePercent(row.share, row.tokens)} share`,
  ];
  if (thread.costUsd !== null && row.cents !== null) {
    figures.push(formatWholeCents(row.cents, thread.costUsd));
  }
  return `${name} (${when}): ${figures.join(", ")}`;
};
