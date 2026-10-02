import type { ProjectIssue } from "@aop/common";
import {
  ArrowUpRightIcon,
  CopyIcon,
  EllipsisIcon,
  GitBranchPlusIcon,
  MessageSquareIcon,
} from "lucide-react";
import { memo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import { formatAge, formatAgo } from "../selectors";
import { AvatarStack, LabelBadge, StageIcon } from "./issue-bits";
import { LinkedPullRequestChips } from "./LinkedPullRequestChips";
import { SOURCE_NAME, SourceMark } from "./source-marks";

const MAX_LABELS = 3;

/**
 * One issue: its source and number, its title (a link to it), its labels and linked pull
 * requests, who it is assigned to, its comments and when it last changed. It reflows with the
 * panel: narrow, the meta wraps under the title; wide (a container query), the comments and the
 * age stand in columns of their own. Actions are behind the row's menu, and Start thread is also
 * a button that shows on hover or focus.
 */
export const IssueRow = memo(
  ({
    issue,
    projectId,
    now,
    starting,
    onStartThread,
  }: {
    issue: ProjectIssue;
    projectId: string;
    now: number;
    starting: boolean;
    onStartThread: (issue: ProjectIssue) => void;
  }) => {
    const shownLabels = issue.labels.slice(0, MAX_LABELS);
    const hiddenLabels = issue.labels.length - shownLabels.length;
    return (
      <li
        data-testid="issue-row"
        data-key={issue.key}
        data-source={issue.source}
        className="group/row relative flex items-start gap-2.5 rounded-row px-2.5 py-2 transition-colors duration-[120ms] hover:bg-hover focus-within:bg-hover"
      >
        <span className="mt-[3px] flex shrink-0 items-center gap-1.5">
          <StageIcon stage={issue.stage} color={issue.stateColor} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <SourceMark source={issue.source} className="translate-y-[2px]" />
            <span
              data-testid="issue-identifier"
              className="shrink-0 text-meta tabular-nums text-text-subtle"
            >
              {issue.identifier}
            </span>
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="issue-title"
              title={issue.title}
              className="min-w-0 truncate text-[14px] font-medium leading-snug text-text hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {issue.title}
            </a>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {shownLabels.map((label) => (
              <LabelBadge key={label.name} label={label} />
            ))}
            {hiddenLabels > 0 ? (
              <span
                className="text-[11px] text-text-subtle"
                title={issue.labels
                  .slice(MAX_LABELS)
                  .map((label) => label.name)
                  .join(", ")}
              >
                +{hiddenLabels}
              </span>
            ) : null}
            <LinkedPullRequestChips projectId={projectId} pullRequests={issue.linkedPullRequests} />
            <InlineMeta issue={issue} now={now} />
          </div>
        </div>
        <ColumnMeta issue={issue} now={now} />
        <div className="flex shrink-0 items-center gap-1 self-center">
          {/* A fixed slot on a wide panel, so the columns line up with or without assignees. */}
          <span className="flex shrink-0 justify-end @xl/issues:w-14">
            <AvatarStack people={issue.assignees} />
          </span>
          <StartThreadButton issue={issue} starting={starting} onStart={onStartThread} />
          <RowMenu issue={issue} starting={starting} onStartThread={onStartThread} />
        </div>
      </li>
    );
  },
);

/** Comments and age under the title, while the panel is too narrow for columns. */
const InlineMeta = ({ issue, now }: { issue: ProjectIssue; now: number }) => (
  <span className="flex items-center gap-2 text-[11.5px] text-text-subtle tabular-nums @xl/issues:hidden">
    {issue.commentCount ? <Comments count={issue.commentCount} /> : null}
    <span title={`Updated ${new Date(issue.updatedAt).toLocaleString()}`}>
      {formatAgo(issue.updatedAt, now)}
    </span>
  </span>
);

/** The same, in columns of their own, once the panel is wide. */
const ColumnMeta = ({ issue, now }: { issue: ProjectIssue; now: number }) => (
  <div className="hidden shrink-0 items-center gap-3 self-center text-meta text-text-subtle tabular-nums @xl/issues:flex">
    <span className="w-10 text-right">
      {issue.commentCount ? <Comments count={issue.commentCount} /> : null}
    </span>
    <span
      data-testid="issue-updated"
      className="w-12 text-right"
      title={`Updated ${new Date(issue.updatedAt).toLocaleString()}`}
    >
      {formatAge(issue.updatedAt, now)}
    </span>
  </div>
);

const Comments = ({ count }: { count: number }) => (
  <span
    data-testid="issue-comments"
    className="inline-flex items-center gap-1"
    title={`${count} ${count === 1 ? "comment" : "comments"}`}
  >
    <MessageSquareIcon aria-hidden="true" className="size-3" />
    {count}
  </span>
);

const ROW_BUTTON =
  "grid size-7 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-active hover:text-text focus-visible:outline-2 focus-visible:outline-running [&_svg]:size-3.5";

// Hidden until the row is hovered or something in it has focus; always there on touch screens.
const REVEAL =
  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100";

const StartThreadButton = ({
  issue,
  starting,
  onStart,
}: {
  issue: ProjectIssue;
  starting: boolean;
  onStart: (issue: ProjectIssue) => void;
}) => (
  <button
    type="button"
    data-testid="issue-start-thread"
    aria-label={`Start a thread for ${issue.identifier}`}
    title="Start a thread"
    disabled={starting}
    onClick={() => onStart(issue)}
    className={cn(ROW_BUTTON, !starting && REVEAL)}
  >
    {starting ? <Spinner className="size-3.5" /> : <GitBranchPlusIcon />}
  </button>
);

const RowMenu = ({
  issue,
  starting,
  onStartThread,
}: {
  issue: ProjectIssue;
  starting: boolean;
  onStartThread: (issue: ProjectIssue) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="issue-menu"
        aria-label={`Actions for ${issue.identifier}`}
        className={cn(ROW_BUTTON, REVEAL, "data-[state=open]:opacity-100")}
      >
        <EllipsisIcon />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56" data-testid="issue-menu-content">
      <DropdownMenuItem
        data-testid="issue-menu-start-thread"
        disabled={starting}
        onSelect={() => onStartThread(issue)}
      >
        <GitBranchPlusIcon />
        Start a thread
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="issue-menu-open" asChild>
        <a href={issue.url} target="_blank" rel="noreferrer noopener">
          <ArrowUpRightIcon />
          Open in {SOURCE_NAME[issue.source]}
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="issue-menu-copy" onSelect={() => void copyLink(issue)}>
        <CopyIcon />
        Copy link
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const copyLink = async (issue: ProjectIssue) => {
  try {
    await navigator.clipboard.writeText(issue.url);
    toast.success(`Copied the link to ${issue.identifier}`);
  } catch {
    toast.error("Could not copy the link");
  }
};
