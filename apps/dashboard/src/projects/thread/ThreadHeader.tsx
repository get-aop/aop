import type { Project, Thread, ThreadStatus } from "@aop/common";
import {
  CheckCheckIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  FolderGit2Icon,
  GitBranchIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { RegisteredRepo } from "../../api/client";
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

/**
 * Who the thread is: a way back, its title, and in one line where it stands, where it works
 * (repository and branch), what runs it, what it has used, and how long ago it moved.
 */
export const ThreadHeader = ({ project, thread }: { project: Project; thread: Thread }) => {
  const repos = useRegisteredRepos();
  const now = useNow();
  const blocked = thread.status === "waiting-on-you";

  return (
    <header data-testid="thread-header" className="shrink-0 px-6 pt-3">
      <div className="flex items-center gap-2">
        <Link
          to={projectPath(project.id)}
          data-testid="thread-back"
          className="-ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-row px-1 text-[13px] text-text-subtle transition-colors duration-[120ms] hover:text-text"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
          Threads
        </Link>
        <span aria-hidden="true" className="text-text-subtle">
          /
        </span>
        <h2
          data-testid="thread-title"
          title={thread.title}
          className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text"
        >
          {thread.title}
        </h2>
        <ThreadMenu thread={thread} />
      </div>
      <div
        data-testid="thread-meta"
        className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-muted"
      >
        <MetaItem testId="thread-status" className={cn(blocked && "text-waiting")}>
          <ThreadStatusDot status={thread.status} />
          {THREAD_STATUS_LABEL[thread.status]}
        </MetaItem>
        {thread.repoId ? (
          <MetaItem testId="thread-repo">
            <FolderGit2Icon aria-hidden="true" className="size-3.5 text-text-subtle" />
            {repoLabel(repos, thread.repoId)}
          </MetaItem>
        ) : null}
        {thread.branch ? (
          <MetaItem testId="thread-branch" title={thread.branch}>
            <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
            <span className="max-w-64 truncate">{thread.branch}</span>
          </MetaItem>
        ) : null}
        <ThreadUsageChip thread={thread} />
        <MetaItem testId="thread-age" title={new Date(thread.lastActivityAt).toLocaleString()}>
          {activeLabel(thread.lastActivityAt, now)}
        </MetaItem>
      </div>
    </header>
  );
};

const MetaItem = ({
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

const ThreadMenu = ({ thread }: { thread: Thread }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="thread-menu"
        aria-label="Thread actions"
        className="grid size-8 shrink-0 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <EllipsisIcon className="size-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56" data-testid="thread-menu-content">
      <DropdownMenuItem
        data-testid="thread-resolve"
        disabled={CANNOT_RESOLVE.has(thread.status)}
        onSelect={() => void threadActions.resolve(thread)}
      >
        <CheckCheckIcon />
        Mark resolved
      </DropdownMenuItem>
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
