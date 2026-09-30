import type { Project, Thread, ThreadStatus } from "@aop/common";
import {
  CheckCheckIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import type { RegisteredRepo } from "../../api/client";
import { IconButton } from "../../components/IconButton";
import { Link, projectPath } from "../../shell/router";
import { formatAge, THREAD_STATUS_LABEL } from "../selectors";
import { ThreadStatusDot } from "../ThreadStatusDot";
import { threadActions } from "../thread-actions";
import { useNow } from "../use-now";
import { useRegisteredRepos } from "../use-registered-repos";
import { ThreadUsageChip } from "./ThreadUsageChip";

// A turn is using the worktree, or a merge is: the host refuses to resolve until they end.
const CANNOT_RESOLVE: ReadonlySet<ThreadStatus> = new Set([
  "working",
  "queued",
  "rate-limited",
  "landing",
  "resolved",
]);

// A turn is running or lined up: Stop ends it.
const STOPPABLE: ReadonlySet<ThreadStatus> = new Set(["working", "queued"]);

/**
 * Who the thread is, in one 56px row that never wraps: the breadcrumb back to the overview with
 * the title (cut to one line; the whole of it in the tooltip, and where the thread stands, where
 * it works and what it used one click away), then resolve, the holder's buttons (expand), the
 * thread's menu, and the holder's close.
 */
export const ThreadHeader = ({
  project,
  thread,
  actions,
  close,
  onShowPullRequestBar,
}: {
  project: Project;
  thread: Thread;
  /** Buttons of whatever holds the thread, between resolve and the menu. */
  actions?: ReactNode;
  /** The holder's close button, last in the row. */
  close?: ReactNode;
  /** Brings back the pull request bar the person sent away; given only while it is away. */
  onShowPullRequestBar?: () => void;
}) => (
  <header data-testid="thread-header" className="flex h-14 shrink-0 items-center gap-1.5 px-6">
    <Link
      to={projectPath(project.id)}
      data-testid="thread-back"
      className="-ml-1 inline-flex shrink-0 items-center rounded-row px-1 text-body text-text-subtle transition-colors duration-[120ms] hover:text-text"
    >
      Threads
    </Link>
    <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
    <ThreadTitle thread={thread} />
    <IconButton
      testId="thread-resolve-button"
      label="Mark resolved"
      disabled={CANNOT_RESOLVE.has(thread.status)}
      onClick={() => void threadActions.resolve(thread)}
    >
      <CheckCircle2Icon />
    </IconButton>
    {actions}
    <ThreadMenu thread={thread} onShowPullRequestBar={onShowPullRequestBar} />
    {close}
  </header>
);

/** The title on one line; pressing it shows the rest of who the thread is. */
const ThreadTitle = ({ thread }: { thread: Thread }) => (
  <Popover>
    <h2 className="flex min-w-0 flex-1">
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="thread-title"
          title={thread.title}
          className="min-w-0 truncate rounded-row px-1 text-left text-body font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
        >
          {thread.title}
        </button>
      </PopoverTrigger>
    </h2>
    <PopoverContent align="start" data-testid="thread-details" className="w-80 text-meta">
      <ThreadDetails thread={thread} />
    </PopoverContent>
  </Popover>
);

/** The whole title, where the thread stands, where it works, what it used, and when it last moved. */
const ThreadDetails = ({ thread }: { thread: Thread }) => {
  const repos = useRegisteredRepos();
  const now = useNow();
  return (
    <div className="flex flex-col gap-2.5 text-text-muted">
      <p className="break-words text-body font-medium text-text">{thread.title}</p>
      <DetailItem
        testId="thread-status"
        className={cn(thread.status === "waiting-on-you" && "text-waiting")}
      >
        <ThreadStatusDot status={thread.status} />
        {THREAD_STATUS_LABEL[thread.status]}
      </DetailItem>
      {thread.repoId ? (
        <DetailItem testId="thread-repo">
          <FolderGit2Icon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
          <span className="break-all">{repoLabel(repos, thread.repoId)}</span>
        </DetailItem>
      ) : null}
      {thread.branch ? (
        <DetailItem testId="thread-details-branch">
          <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
          <span className="break-all">{thread.branch}</span>
        </DetailItem>
      ) : null}
      <DetailItem testId="thread-age" title={new Date(thread.lastActivityAt).toLocaleString()}>
        {activeLabel(thread.lastActivityAt, now)}
      </DetailItem>
      <ThreadUsageChip thread={thread} />
    </div>
  );
};

const DetailItem = ({
  testId,
  title,
  className,
  children,
}: {
  testId: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    data-testid={testId}
    title={title}
    className={cn("flex min-w-0 items-center gap-1.5", className)}
  >
    {children}
  </div>
);

const ThreadMenu = ({
  thread,
  onShowPullRequestBar,
}: {
  thread: Thread;
  onShowPullRequestBar?: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="thread-menu"
        aria-label="Thread actions"
        title="Thread actions"
        className="grid size-8 shrink-0 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <EllipsisIcon className="size-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56" data-testid="thread-menu-content">
      {STOPPABLE.has(thread.status) ? (
        <DropdownMenuItem
          data-testid="thread-stop"
          onSelect={() => void threadActions.stop(thread)}
        >
          <SquareIcon />
          Stop
        </DropdownMenuItem>
      ) : null}
      {thread.status === "rate-limited" ? (
        <DropdownMenuItem
          data-testid="thread-menu-resume"
          onSelect={() => void threadActions.resume(thread)}
        >
          <RotateCcwIcon />
          Resume now
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        data-testid="thread-resolve"
        disabled={CANNOT_RESOLVE.has(thread.status)}
        onSelect={() => void threadActions.resolve(thread)}
      >
        <CheckCheckIcon />
        Mark resolved
      </DropdownMenuItem>
      {onShowPullRequestBar ? (
        <DropdownMenuItem data-testid="thread-show-pr-bar" onSelect={onShowPullRequestBar}>
          <GitPullRequestIcon />
          Show pull request bar
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        data-testid="thread-delete"
        onSelect={() => void threadActions.remove(thread)}
      >
        <Trash2Icon />
        Delete thread
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

// "Active now", "Active 5m ago", "Active Sep 29": formatAge's terse ages, in a sentence.
const activeLabel = (iso: string, now: number): string => {
  const age = formatAge(iso, now);
  if (age === "now") return "Active now";
  return /^\d+[mhd]$/.test(age) ? `Active ${age} ago` : `Active ${age}`;
};

const repoLabel = (repos: RegisteredRepo[] | null, repoId: string): string => {
  const repo = repos?.find(({ id }) => id === repoId);
  return repo ? (repo.name ?? repo.path.split("/").filter(Boolean).at(-1) ?? repo.path) : repoId;
};
