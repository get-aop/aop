import type { Project, ProjectUsage } from "@aop/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { getProjectUsage } from "../../api/usage";
import { useNow } from "../use-now";
import { CopyUsageButton, UsageOverview } from "./UsageOverview";
import { UsageByModel } from "./UsageTables";
import { UsageThreads } from "./UsageThreads";
import {
  rangeOf,
  sortThreadRows,
  type ThreadRow,
  type ThreadSort,
  threadRows,
  totalTokens,
  USAGE_WINDOWS,
  type UsageWindowId,
} from "./usage-math";
import { usageSummary } from "./usage-summary";
import { useRefreshOnActivity } from "./use-refresh-on-activity";

/**
 * What the project's runs consumed in a window: the headline figures and where the tokens went,
 * then every session's share. The copy button puts the same on the clipboard as text.
 */
export const UsageSection = ({ project }: { project: Project }) => {
  const [windowId, setWindowId] = useState<UsageWindowId>("all");
  const [sort, setSort] = useState<ThreadSort>("share");
  const usage = useProjectUsage(project.id, windowId);
  const now = useNow();
  const data = usage.data;
  const rows = useMemo(
    () => (data ? sortThreadRows(threadRows(data.threads, totalTokens(data.totals)), sort) : []),
    [data, sort],
  );
  const summary =
    data && rows.length > 0
      ? usageSummary({
          projectName: project.name,
          windowLabel: USAGE_WINDOWS.find((window) => window.id === windowId)?.label ?? "",
          usage: data,
          rows,
          sort,
          now,
        })
      : null;

  return (
    <div data-testid="settings-usage" data-window={windowId} className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-[14px] font-medium text-text">This project</h3>
          <p className="text-[12.5px] text-text-subtle">
            Tokens the coordinator and threads used. A run counts in the window it finished in.
          </p>
        </div>
        <CopyUsageButton text={summary} />
      </div>
      <WindowPicker value={windowId} onChange={setWindowId} />
      <UsageState usage={usage} />
      {data ? (
        <UsageResults
          projectId={project.id}
          usage={data}
          rows={rows}
          sort={sort}
          onSort={setSort}
          now={now}
        />
      ) : null}
    </div>
  );
};

const UsageResults = ({
  projectId,
  usage,
  rows,
  sort,
  onSort,
  now,
}: {
  projectId: string;
  usage: ProjectUsage;
  rows: readonly ThreadRow[];
  sort: ThreadSort;
  onSort: (sort: ThreadSort) => void;
  now: number;
}) =>
  rows.length === 0 ? (
    <UsageEmpty />
  ) : (
    <>
      <UsageOverview usage={usage} rows={rows} />
      <UsageThreads projectId={projectId} rows={rows} sort={sort} onSort={onSort} now={now} />
      {/* One model is already named over the breakdown; several get a row each, with cost. */}
      {usage.byModel.length > 1 ? <UsageByModel models={usage.byModel} /> : null}
    </>
  );

const UsageState = ({ usage }: { usage: ProjectUsageState }) => {
  if (usage.error) {
    return (
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
    );
  }
  return usage.data === null ? (
    <p data-testid="usage-loading" className="text-[12.5px] text-text-subtle">
      Loading usage…
    </p>
  ) : null;
};

const UsageEmpty = () => (
  <div
    data-testid="usage-empty"
    className="mt-2 flex flex-col items-center gap-1 rounded-row border border-dashed border-border px-6 py-10 text-center"
  >
    <h3 className="text-[13px] font-medium text-text">No usage in this window</h3>
    <p className="max-w-sm text-[12.5px] text-text-subtle">
      Usage appears here once the coordinator or a thread finishes a turn.
    </p>
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
