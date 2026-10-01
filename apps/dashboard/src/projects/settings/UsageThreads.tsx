import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Link, threadPath } from "../../shell/router";
import { formatAgo } from "../selectors";
import { formatWholeCents, formatWholePercent } from "./format";
import { TokenCount } from "./UsageTables";
import { THREAD_SORTS, type ThreadRow, type ThreadSort } from "./usage-math";
import { formatCacheHit, formatThreadModels } from "./usage-summary";

// Phone: the name and its model line span the row, then bar, tokens, cache hit and share under
// them. From sm: one line, with the cost last.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_5rem_4.5rem_4.5rem_3.5rem_4rem]";
const NUMBER = "text-right text-[13px] tabular-nums";

/** Every session that used tokens in the window, with its share of the whole as a bar. */
export const UsageThreads = ({
  projectId,
  rows,
  sort,
  onSort,
  now,
}: {
  projectId: string;
  rows: readonly ThreadRow[];
  sort: ThreadSort;
  onSort: (sort: ThreadSort) => void;
  now: number;
}) => {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0) || 1;
  return (
    <section data-testid="usage-by-thread" className="flex flex-col pt-8">
      <div className="flex items-center gap-2 pb-3">
        <h3 className="flex-1 text-[14px] font-medium text-text">Threads</h3>
        <SortMenu sort={sort} onSort={onSort} />
      </div>
      <div aria-hidden="true" className={cn(ROW_GRID, "pb-1.5 text-[12px] text-text-subtle")}>
        <span className="sm:col-span-3" />
        <span className="text-right">Tokens</span>
        <span className="text-right">Cache hit</span>
        <span className="text-right">Share</span>
        <span className="hidden text-right sm:block">Cost</span>
      </div>
      <ul data-testid="usage-thread-list" data-sort={sort}>
        {rows.map((row) => (
          <ThreadLine
            key={row.thread.threadId}
            projectId={projectId}
            row={row}
            total={total}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
};

const ThreadLine = ({
  projectId,
  row,
  total,
  now,
}: {
  projectId: string;
  row: ThreadRow;
  total: number;
  now: number;
}) => {
  const { thread } = row;
  return (
    <li
      data-testid="usage-thread-row"
      data-thread-id={thread.threadId}
      data-kind={thread.kind}
      className={cn(ROW_GRID, "gap-y-1 border-t border-border py-2.5")}
    >
      <span className="col-span-4 min-w-0 truncate text-[13.5px] sm:col-span-1">
        {thread.kind === "coordinator" ? (
          <span data-cell="title" className="font-medium text-text">
            Coordinator
          </span>
        ) : (
          <Link
            data-cell="title"
            to={threadPath(projectId, thread.threadId)}
            title={thread.title}
            className="text-text underline decoration-border-bold underline-offset-4 hover:decoration-text"
          >
            {thread.title}
          </Link>
        )}
      </span>
      <span
        data-cell="when"
        className="col-span-4 truncate text-[12.5px] text-text-subtle sm:col-span-1"
      >
        {formatThreadModels(thread.models)}{" "}
        <time dateTime={thread.lastRunAt}>{formatAgo(thread.lastRunAt, now)}</time>
      </span>
      <span data-cell="bar" className="h-1 rounded-[2px] bg-border">
        <span
          className="block h-full min-w-px rounded-[2px] bg-running"
          style={{ width: `${(row.tokens / total) * 100}%` }}
        />
      </span>
      <span data-cell="tokens" className={cn(NUMBER, "text-text")}>
        <TokenCount value={row.tokens} />
      </span>
      <span data-cell="cache-hit" className={cn(NUMBER, "text-text-muted")}>
        {formatCacheHit(row.cacheHit)}
      </span>
      <span data-cell="share" className={cn(NUMBER, "text-text-muted")}>
        {formatWholePercent(row.share, row.tokens)}
      </span>
      <span data-cell="cost" className={cn(NUMBER, "hidden text-text-muted sm:block")}>
        {thread.costUsd === null || row.cents === null
          ? "–"
          : formatWholeCents(row.cents, thread.costUsd)}
      </span>
    </li>
  );
};

const SortMenu = ({ sort, onSort }: { sort: ThreadSort; onSort: (sort: ThreadSort) => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="sm" data-testid="usage-sort" data-sort={sort}>
        Sort by: {THREAD_SORTS.find((option) => option.id === sort)?.label}
        <ChevronDownIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" data-testid="usage-sort-menu" className="w-40">
      <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSort(value as ThreadSort)}>
        {THREAD_SORTS.map((option) => (
          <DropdownMenuRadioItem
            key={option.id}
            value={option.id}
            data-testid={`usage-sort-${option.id}`}
          >
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
