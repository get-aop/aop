import type { ProjectIssue } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNow } from "../use-now";
import { IssueRow } from "./IssueRow";
import { StageIcon } from "./issue-bits";
import type { IssueGroup, IssueGroupBy } from "./issue-view";
import type { StartThread } from "./use-start-thread";

/**
 * Issues in collapsible groups, each with its count: the grouped-table pattern. A group's
 * header sticks to the top while its rows scroll under it. By status, done and canceled groups
 * start folded when open work is listed beside them, so the open work is what shows.
 */
export const IssueGroupedTable = ({
  projectId,
  groups,
  groupBy,
  filtering,
  isCollapsed,
  onToggle,
  startThread,
}: {
  projectId: string;
  groups: readonly IssueGroup[];
  groupBy: IssueGroupBy;
  /** A search or filter is on: every group starts open, so no match is folded away. */
  filtering: boolean;
  isCollapsed: (groupId: string, folded: boolean) => boolean;
  onToggle: (groupId: string, collapsed: boolean) => void;
  startThread: StartThread;
}) => {
  const now = useNow();
  // Finished work folds away only when there is open work to show instead.
  const foldFinished =
    !filtering && groupBy === "status" && groups.some((group) => !isFinished(group));
  return (
    <div data-testid="issue-groups" data-group-by={groupBy} className="flex flex-col gap-1">
      {groups.map((group) => {
        const collapsed = isCollapsed(group.id, foldFinished && isFinished(group));
        return (
          <section
            key={group.id}
            data-testid="issue-group"
            data-group={group.id}
            data-open={!collapsed}
            data-count={group.issues.length}
            aria-label={`${group.label}, ${group.issues.length}`}
          >
            <GroupHeader
              group={group}
              collapsed={collapsed}
              onToggle={() => onToggle(group.id, !collapsed)}
            />
            {collapsed ? null : (
              <ul className="flex flex-col py-0.5">
                {group.issues.map((issue: ProjectIssue) => (
                  <IssueRow
                    key={issue.key}
                    issue={issue}
                    projectId={projectId}
                    now={now}
                    starting={startThread.pending.has(issue.key)}
                    onStartThread={startThread.start}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
};

const isFinished = (group: IssueGroup): boolean =>
  group.stage === "completed" || group.stage === "canceled";

const GroupHeader = ({
  group,
  collapsed,
  onToggle,
}: {
  group: IssueGroup;
  collapsed: boolean;
  onToggle: () => void;
}) => (
  <h3 className="sticky top-0 z-[1] bg-surface">
    <button
      type="button"
      data-testid="issue-group-toggle"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex h-9 w-full items-center gap-2 rounded-row bg-hover px-2.5 text-left text-[13.5px] font-medium text-text transition-colors duration-[120ms] hover:bg-active focus-visible:outline-2 focus-visible:outline-running"
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 text-text-subtle transition-transform duration-[120ms]",
          collapsed && "-rotate-90",
        )}
      />
      <GroupMarker group={group} />
      <span className="min-w-0 truncate">{group.label}</span>
      <span
        data-testid="issue-group-count"
        className="rounded-full bg-active px-1.5 text-[11px] font-semibold tabular-nums text-text-muted"
      >
        {group.issues.length}
      </span>
    </button>
  </h3>
);

const GroupMarker = ({ group }: { group: IssueGroup }) => {
  if (group.stage) return <StageIcon stage={group.stage} color={group.color} />;
  if (group.color) {
    return (
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: `#${group.color}` }}
      />
    );
  }
  return null;
};
