import type { IssueList, IssueStateFilter } from "@aop/common";
import { CircleDotIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";

/*
 * What the tab shows instead of the table: while it first loads, when the host could not
 * answer, when there is nothing to list, and when the filters leave nothing.
 */

export const IssuesLoading = () => (
  <div
    data-testid="issues-loading"
    role="status"
    aria-busy="true"
    aria-label="Loading issues"
    className="flex flex-col gap-1 pt-1"
  >
    <Skeleton className="mb-1 h-9 rounded-row bg-hover" />
    {[0.9, 0.7, 0.8, 0.6, 0.75].map((width) => (
      <div key={width} className="flex items-start gap-2.5 px-2.5 py-2.5">
        <Skeleton className="mt-0.5 size-3.5 rounded-full bg-active" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 bg-active" style={{ width: `${width * 100}%` }} />
          <Skeleton className="h-3 w-24 bg-hover" />
        </div>
      </div>
    ))}
  </div>
);

const State = ({
  testId,
  icon,
  title,
  children,
  action,
}: {
  testId: string;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <div data-testid={testId} className="flex flex-col items-center gap-2 px-6 py-12 text-center">
    <span className="mb-1 grid size-10 place-items-center rounded-card bg-raised text-text-subtle [&_svg]:size-5">
      {icon}
    </span>
    <p className="text-[14px] font-medium text-text">{title}</p>
    {children ? (
      <p className="max-w-xs text-meta leading-relaxed text-text-subtle">{children}</p>
    ) : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);

export const IssuesError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <State
    testId="issues-error"
    icon={<TriangleAlertIcon />}
    title="Could not load issues"
    action={
      <Button size="sm" variant="secondary" data-testid="issues-retry" onClick={onRetry}>
        Try again
      </Button>
    }
  >
    {message}
  </State>
);

const STATE_WORD: Record<IssueStateFilter, string> = { open: "open ", closed: "closed ", all: "" };

/**
 * Nothing to list. With no source at all (no GitHub repository, no Linear) it says how to add
 * one; otherwise it is just that: no issues in this state.
 */
export const IssuesEmpty = ({
  list,
  state,
  owner,
  onConnectLinear,
}: {
  list: IssueList;
  state: IssueStateFilter;
  owner: boolean;
  onConnectLinear: () => void;
}) => {
  const reading = list.sources.some((source) => source.status === "ok");
  if (!reading) {
    return (
      <State
        testId="issues-no-sources"
        icon={<CircleDotIcon />}
        title="No issue source yet"
        action={
          owner && list.sources.some((source) => source.status === "not-configured") ? (
            <Button
              size="sm"
              variant="secondary"
              data-testid="issues-empty-linear"
              onClick={onConnectLinear}
            >
              Connect Linear
            </Button>
          ) : null
        }
      >
        Attach a GitHub repository in the project's settings, or connect Linear, and their issues
        show here.
      </State>
    );
  }
  return (
    <State testId="issues-empty" icon={<CircleDotIcon />} title={`No ${STATE_WORD[state]}issues`}>
      {state === "open" ? "Nothing open in this project's repositories right now." : null}
    </State>
  );
};

export const NoMatch = ({ onClear }: { onClear: () => void }) => (
  <State
    testId="issues-no-match"
    icon={<SearchXIcon />}
    title="No issues match"
    action={
      <Button size="sm" variant="ghost" data-testid="issues-no-match-clear" onClick={onClear}>
        Clear search and filters
      </Button>
    }
  />
);
