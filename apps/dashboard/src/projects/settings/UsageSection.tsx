import type { Project, ProjectUsage } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { getProjectUsage } from "../../api/usage";
import { SettingsBlock } from "./blocks";
import { formatCost, formatShare } from "./format";
import { TokenCount, UsageByModel, UsageByThread } from "./UsageTables";
import {
  cacheReadShare,
  rangeOf,
  totalTokens,
  USAGE_WINDOWS,
  type UsageWindowId,
} from "./usage-math";
import { useRefreshOnActivity } from "./use-refresh-on-activity";

/** What the project's runs consumed in a window: totals, then by model and by thread. */
export const UsageSection = ({ project }: { project: Project }) => {
  const [windowId, setWindowId] = useState<UsageWindowId>("all");
  const usage = useProjectUsage(project.id, windowId);

  return (
    <div data-testid="settings-usage" data-window={windowId} className="flex flex-col">
      <SettingsBlock
        title="This project"
        description="Tokens the coordinator and threads used. A run counts in the window it finished in."
      >
        <WindowPicker value={windowId} onChange={setWindowId} />
        {usage.error ? (
          <p role="alert" data-testid="usage-error" className="text-[12.5px] text-blocked">
            {usage.error}{" "}
            <Button
              type="button"
              variant="link"
              size="xs"
              data-testid="usage-retry"
              onClick={usage.refresh}
            >
              Try again
            </Button>
          </p>
        ) : null}
        {usage.data === null && !usage.error ? (
          <p data-testid="usage-loading" className="text-[12.5px] text-text-subtle">
            Loading usage…
          </p>
        ) : null}
      </SettingsBlock>
      {usage.data ? <UsageBody projectId={project.id} usage={usage.data} /> : null}
    </div>
  );
};

const UsageBody = ({ projectId, usage }: { projectId: string; usage: ProjectUsage }) => {
  if (usage.threads.length === 0) {
    return (
      <div
        data-testid="usage-empty"
        className="flex flex-col items-center gap-1 rounded-row border border-dashed border-border px-6 py-10 text-center"
      >
        <h3 className="text-[13px] font-medium text-text">No usage in this window</h3>
        <p className="max-w-sm text-[12.5px] text-text-subtle">
          Usage appears here once the coordinator or a thread finishes a turn.
        </p>
      </div>
    );
  }
  const total = totalTokens(usage.totals);
  return (
    <>
      <Summary usage={usage} total={total} />
      <UsageByModel models={usage.byModel} />
      <UsageByThread projectId={projectId} threads={usage.threads} total={total} />
    </>
  );
};

const Summary = ({ usage, total }: { usage: ProjectUsage; total: number }) => {
  const { totals } = usage;
  const cache = cacheReadShare(totals);
  const coordinator = usage.threads
    .filter((thread) => thread.kind === "coordinator")
    .reduce((sum, thread) => sum + totalTokens(thread), 0);
  const threadCount = usage.threads.filter((thread) => thread.kind === "thread").length;

  return (
    <SettingsBlock title="Totals" testId="usage-summary">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat testId="usage-stat-threads" label="Threads" value={String(threadCount)} />
        <Stat
          testId="usage-stat-tokens"
          label="Tokens"
          value={<TokenCount value={total} />}
          detail={`${totals.runs} ${totals.runs === 1 ? "run" : "runs"}`}
        />
        <Stat
          testId="usage-stat-cache-hit"
          label="Cache hit"
          value={cache.whole === 0 ? "–" : formatShare(cache.part, cache.whole)}
          detail="of input from cache"
        />
        <Stat
          testId="usage-stat-coordinator"
          label="Coordinator"
          value={formatShare(coordinator, total)}
          detail="of all tokens"
        />
        <Stat
          testId="usage-stat-cost"
          label="Cost"
          value={totals.costUsd === null ? "Not reported" : formatCost(totals.costUsd)}
          detail={totals.costUsd === null ? "no run reported one" : "as the CLI reported"}
        />
      </dl>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          testId="usage-stat-input"
          label="Input"
          value={<TokenCount value={totals.inputTokens} />}
        />
        <Stat
          testId="usage-stat-output"
          label="Output"
          value={<TokenCount value={totals.outputTokens} />}
        />
        <Stat
          testId="usage-stat-cache-write"
          label="Cache write"
          value={<TokenCount value={totals.cacheWriteTokens} />}
        />
        <Stat
          testId="usage-stat-cache-read"
          label="Cache read"
          value={<TokenCount value={totals.cacheReadTokens} />}
        />
      </dl>
    </SettingsBlock>
  );
};

const Stat = ({
  testId,
  label,
  value,
  detail,
}: {
  testId: string;
  label: string;
  value: React.ReactNode;
  detail?: string;
}) => (
  <div
    data-testid={testId}
    className="flex flex-col gap-0.5 rounded-row border border-border bg-raised px-3 py-2.5"
  >
    <dt className="text-[12px] text-text-subtle">{label}</dt>
    <dd className="text-[18px] font-semibold tabular-nums text-text">{value}</dd>
    {detail ? <p className="text-[11.5px] text-text-subtle">{detail}</p> : null}
  </div>
);

const WindowPicker = ({
  value,
  onChange,
}: {
  value: UsageWindowId;
  onChange: (id: UsageWindowId) => void;
}) => (
  <fieldset data-testid="usage-window" className="flex flex-wrap gap-1.5">
    <legend className="sr-only">Time window</legend>
    {USAGE_WINDOWS.map((window) => (
      <button
        key={window.id}
        type="button"
        data-testid={`usage-window-${window.id}`}
        aria-pressed={value === window.id}
        onClick={() => onChange(window.id)}
        className={cn(
          "h-8 rounded-md border px-3 text-[12.5px] font-medium transition-colors duration-[120ms]",
          value === window.id
            ? "border-border-bold bg-raised text-text"
            : "border-border text-text-muted hover:bg-hover hover:text-text",
        )}
      >
        {window.label}
      </button>
    ))}
  </fieldset>
);

interface ProjectUsageState {
  data: ProjectUsage | null;
  error: string | null;
  refresh: () => void;
}

const useProjectUsage = (projectId: string, windowId: UsageWindowId): ProjectUsageState => {
  const [data, setData] = useState<ProjectUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Answers arrive in any order: only the newest request may set the state.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    getProjectUsage(projectId, rangeOf(windowId, Date.now())).then(
      (loaded) => {
        if (request !== latest.current) return;
        setData(loaded);
        setError(null);
      },
      (cause: unknown) => {
        if (request !== latest.current) return;
        setError(cause instanceof Error ? cause.message : "Could not load usage");
      },
    );
  }, [projectId, windowId]);

  useEffect(() => {
    setData(null);
    setError(null);
    refresh();
  }, [refresh]);
  useRefreshOnActivity(projectId, refresh);

  return { data, error, refresh };
};
