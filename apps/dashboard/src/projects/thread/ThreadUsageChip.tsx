import { formatRuntimeModelLabel, type Thread, type ThreadUsage } from "@aop/common";
import { CoinsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { getThreadUsage } from "../../api/threads";
import { formatCost, formatShare, formatTokens } from "../settings/format";
import { cacheReadShare, totalTokens } from "../settings/usage-math";

/**
 * What the thread's runs consumed, as tokens (and cost, when the runtime reported one) in the
 * header, with the buckets and models behind it one click away. It is read again whenever the
 * thread changes status, since a run records its usage when it ends. It says nothing before
 * the first run and when the host cannot answer: usage is context, not something to block on.
 */
export const ThreadUsageChip = ({ thread }: { thread: Thread }) => {
  const usage = useThreadUsage(thread.id, thread.status);
  if (!usage || usage.totals.runs === 0) return null;
  const { totals } = usage;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="thread-usage"
          data-tokens={totalTokens(totals)}
          className="flex items-center gap-1.5 rounded-row text-meta text-text-muted transition-colors duration-[120ms] hover:text-text"
        >
          <CoinsIcon aria-hidden="true" className="size-3.5 text-text-subtle" />
          {formatTokens(totalTokens(totals))} tokens
          {totals.costUsd === null ? "" : ` · ${formatCost(totals.costUsd)}`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" data-testid="thread-usage-details" className="w-72 text-meta">
        <UsageDetails usage={usage} />
      </PopoverContent>
    </Popover>
  );
};

const UsageDetails = ({ usage }: { usage: ThreadUsage }) => {
  const { totals, byModel } = usage;
  const cache = cacheReadShare(totals);
  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <Row label="Input" value={totals.inputTokens} testId="usage-input" />
        <Row label="Output" value={totals.outputTokens} testId="usage-output" />
        <Row label="Cache write" value={totals.cacheWriteTokens} testId="usage-cache-write" />
        <Row label="Cache read" value={totals.cacheReadTokens} testId="usage-cache-read" />
      </dl>
      <p className="text-text-subtle">
        {formatShare(cache.part, cache.whole)} of what the model read came from the cache ·{" "}
        {totals.runs} {totals.runs === 1 ? "run" : "runs"}
      </p>
      {byModel.length > 0 ? (
        <p className="text-text-subtle">
          {byModel.map((model) => formatRuntimeModelLabel(model.model)).join(", ")}
        </p>
      ) : null}
    </div>
  );
};

const Row = ({ label, value, testId }: { label: string; value: number; testId: string }) => (
  <>
    <dt className="text-text-muted">{label}</dt>
    <dd data-testid={testId} data-value={value} className="text-right tabular-nums text-text">
      {value.toLocaleString("en-US")}
    </dd>
  </>
);

// `status` is a dependency only: a change of status is the moment a run has just recorded its usage.
const useThreadUsage = (threadId: string, status: Thread["status"]): ThreadUsage | null => {
  const [usage, setUsage] = useState<ThreadUsage | null>(null);
  useEffect(() => {
    void status;
    let cancelled = false;
    getThreadUsage(threadId)
      .then((next) => {
        if (!cancelled) setUsage(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [threadId, status]);
  return usage;
};
