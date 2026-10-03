import type { IssueList, IssueSource } from "@aop/common";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useIsHostOwner } from "../../settings/use-host-owner";
import { formatAgo } from "../selectors";
import { IssueGroupedTable } from "./IssueGroupedTable";
import { IssueSourceNotices } from "./IssueSourceNotices";
import { IssuesEmpty, IssuesError, IssuesLoading, NoMatch } from "./IssuesStates";
import { IssuesToolbar } from "./IssuesToolbar";
import {
  activeFilterCount,
  facetsOf,
  filterIssues,
  groupIssues,
  type IssueGroup,
  sortIssues,
} from "./issue-view";
import { JiraConnectDialog } from "./jira/JiraConnectDialog";
import { LinearConnectDialog } from "./LinearConnectDialog";
import { JiraMark, LinearMark } from "./source-marks";
import { type IssueView, useIssueView } from "./use-issue-view";
import { type IssuesState, useIssues } from "./use-issues";
import { type StartThread, useStartThread } from "./use-start-thread";

/**
 * The panel's Issues tab: every issue of the project's GitHub repositories, of its Linear team or
 * project and of its Jira projects or JQL query, read through the host, in collapsible groups (by status, label, milestone,
 * assignee or repository), with search, filters and sort. It lays itself out by its own width
 * (`@container/issues`), so it reads the same in the narrow panel and expanded.
 */
export const IssuesTab = ({ projectId }: { projectId: string }) => {
  const view = useIssueView(projectId);
  const issues = useIssues(projectId, view.state);
  const startThread = useStartThread(projectId);
  const owner = useIsHostOwner(true);
  const [connecting, setConnecting] = useState<Tracker | null>(null);
  const connectLinear = () => setConnecting("linear");
  const connectJira = () => setConnecting("jira");
  const search = useSearchShortcut();

  const all = issues.list?.issues ?? [];
  const facets = useMemo(() => facetsOf(all), [all]);
  const shown = useMemo(
    () => sortIssues(filterIssues(all, view.filters), view.sort),
    [all, view.filters, view.sort],
  );
  const groups = useMemo(() => groupIssues(shown, view.groupBy), [shown, view.groupBy]);
  const filtering = view.filters.query.trim() !== "" || activeFilterCount(view.filters) > 0;

  return (
    <div
      data-testid="issues-tab"
      data-state={issues.loading ? "loading" : issues.list ? "ready" : "error"}
      className="@container/issues flex min-h-0 flex-1 flex-col"
    >
      <IssuesToolbar ref={search} view={view} facets={facets} sources={sourcesIn(issues.list)} />
      <SummaryBar
        list={issues.list}
        shown={shown.length}
        filtering={filtering}
        refreshing={issues.refreshing}
        error={issues.error}
        onRefresh={issues.refresh}
        onClear={view.clearFilters}
        onConnect={setConnecting}
      />
      <div data-testid="issues-scroll" className="min-h-0 flex-1 overflow-y-auto">
        {issues.list ? (
          <IssueSourceNotices
            projectId={projectId}
            sources={issues.list.sources}
            owner={owner}
            onConnectLinear={connectLinear}
            onConnectJira={connectJira}
          />
        ) : null}
        <div className="px-2 pb-6">
          <IssuesBody
            projectId={projectId}
            issues={issues}
            view={view}
            shownCount={shown.length}
            groups={groups}
            filtering={filtering}
            owner={owner}
            startThread={startThread}
            onConnectLinear={connectLinear}
            onConnectJira={connectJira}
          />
          {issues.list?.sources.some((source) => source.hasMore) ? (
            <LoadMore busy={issues.refreshing} onLoadMore={issues.loadMore} />
          ) : null}
        </div>
      </div>
      <LinearConnectDialog
        projectId={projectId}
        open={connecting === "linear"}
        owner={owner}
        onOpenChange={(open) => setConnecting(open ? "linear" : null)}
        onChanged={issues.refresh}
      />
      <JiraConnectDialog
        projectId={projectId}
        open={connecting === "jira"}
        owner={owner}
        onOpenChange={(open) => setConnecting(open ? "jira" : null)}
        onChanged={issues.refresh}
      />
    </div>
  );
};

/** The table, or what stands in for it: loading, an error, nothing to list, nothing matching. */
const IssuesBody = ({
  projectId,
  issues,
  view,
  shownCount,
  groups,
  filtering,
  owner,
  startThread,
  onConnectLinear,
  onConnectJira,
}: {
  projectId: string;
  issues: IssuesState;
  view: IssueView;
  shownCount: number;
  groups: IssueGroup[];
  filtering: boolean;
  owner: boolean;
  startThread: StartThread;
  onConnectLinear: () => void;
  onConnectJira: () => void;
}) => {
  if (issues.loading) return <IssuesLoading />;
  if (!issues.list) {
    return (
      <IssuesError
        message={issues.error ?? "Could not read the issues."}
        onRetry={issues.refresh}
      />
    );
  }
  if (issues.list.issues.length === 0) {
    return (
      <IssuesEmpty
        list={issues.list}
        state={view.state}
        owner={owner}
        onConnectLinear={onConnectLinear}
        onConnectJira={onConnectJira}
      />
    );
  }
  if (shownCount === 0) return <NoMatch onClear={view.clearFilters} />;
  return (
    <IssueGroupedTable
      projectId={projectId}
      groups={groups}
      groupBy={view.groupBy}
      filtering={filtering}
      isCollapsed={view.isCollapsed}
      onToggle={view.setCollapsed}
      startThread={startThread}
    />
  );
};

const LoadMore = ({ busy, onLoadMore }: { busy: boolean; onLoadMore: () => void }) => (
  <div className="flex justify-center pt-3">
    <button
      type="button"
      data-testid="issues-load-more"
      disabled={busy}
      onClick={onLoadMore}
      className="h-8 rounded-row border border-border-strong px-3 text-meta text-text-muted hover:bg-hover hover:text-text disabled:opacity-50"
    >
      Load older issues
    </button>
  </div>
);

type Tracker = "linear" | "jira";

const TRACKER_BUTTONS: { tracker: Tracker; label: string; Mark: typeof LinearMark }[] = [
  { tracker: "linear", label: "Linear connection", Mark: LinearMark },
  { tracker: "jira", label: "Jira connection", Mark: JiraMark },
];

/** How many issues show, when they were read, and Refresh, Linear and Jira. */
const SummaryBar = ({
  list,
  shown,
  filtering,
  refreshing,
  error,
  onRefresh,
  onClear,
  onConnect,
}: {
  list: IssueList | null;
  shown: number;
  filtering: boolean;
  refreshing: boolean;
  /** Why the last refresh the person asked for failed; the list shown stays. */
  error: string | null;
  onRefresh: () => void;
  onClear: () => void;
  onConnect: (tracker: Tracker) => void;
}) => {
  const total = list?.issues.length ?? 0;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4 text-meta text-text-subtle">
      <span data-testid="issues-count" className="tabular-nums">
        {list
          ? filtering
            ? `${shown} of ${total}`
            : `${total} ${total === 1 ? "issue" : "issues"}`
          : ""}
      </span>
      {filtering ? (
        <button
          type="button"
          data-testid="issues-clear"
          onClick={onClear}
          className="rounded px-1 hover:text-text"
        >
          Clear
        </button>
      ) : null}
      <span className="flex-1" />
      <ReadState list={list} error={error} />
      {TRACKER_BUTTONS.map(({ tracker, label, Mark }) => (
        <button
          key={tracker}
          type="button"
          data-testid={`issues-${tracker}`}
          aria-label={label}
          title={label}
          onClick={() => onConnect(tracker)}
          className="grid size-7 place-items-center rounded-row hover:bg-hover hover:text-text"
        >
          <Mark className="size-3.5" />
        </button>
      ))}
      <button
        type="button"
        data-testid="issues-refresh"
        aria-label="Refresh issues"
        title="Refresh issues"
        disabled={refreshing}
        onClick={onRefresh}
        className="grid size-7 place-items-center rounded-row hover:bg-hover hover:text-text disabled:opacity-60"
      >
        <RefreshCwIcon
          aria-hidden="true"
          className={cn("size-3.5", refreshing && "animate-spin")}
        />
      </button>
    </div>
  );
};

/** When the list was read, or that the last refresh failed (the list shown is the older one). */
const ReadState = ({ list, error }: { list: IssueList | null; error: string | null }) => {
  if (list && error) {
    return (
      <span data-testid="issues-refresh-failed" title={error} className="truncate text-waiting">
        Could not refresh
      </span>
    );
  }
  const readAt = latestRead(list);
  return readAt ? (
    <span data-testid="issues-read-at" className="hidden truncate @md/issues:inline">
      Updated {formatAgo(readAt)}
    </span>
  ) : null;
};

/** The newest read across sources: what "Updated …" says. */
const latestRead = (list: IssueList | null): string | null =>
  list?.sources
    .map((source) => source.fetchedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1) ?? null;

const sourcesIn = (list: IssueList | null): IssueSource[] => [
  ...new Set((list?.issues ?? []).map((issue) => issue.source)),
];

/** "/" puts the cursor in the search box, unless the person is typing somewhere already. */
const useSearchShortcut = () => {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable=true], [role=dialog]");
      if (typing) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return search;
};
