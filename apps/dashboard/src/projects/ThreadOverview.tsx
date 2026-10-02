import { shownThreadStatus, type Thread, type ThreadStatus } from "@aop/common";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/ui/input";
import { skipsPermissions, useAgentClis } from "../agent-clis/agent-cli-store";
import { useDisplayName } from "../settings/display-name";
import { greetingOf } from "./greeting";
import type { OverviewFilters } from "./layout/use-overview-filters";
import type { ProjectEntry } from "./projects-state";
import {
  ALWAYS_LISTED,
  attentionOf,
  attentionSentence,
  emptyGroupLine,
  groupThreads,
  matchesThreadSearch,
  THREAD_STATUS_LABEL,
} from "./selectors";
import { ThreadCard } from "./ThreadCard";
import { ThreadStatusDot } from "./ThreadStatusDot";
import { ThreadsLoadError } from "./ThreadsLoadError";
import { useNow } from "./use-now";

const LISTED_AT_ZERO = Object.keys(ALWAYS_LISTED) as ThreadStatus[];

// Closed work is out of the way until asked for; everything else is what the person may need.
const COLLAPSED_BY_DEFAULT: ReadonlySet<ThreadStatus> = new Set(["resolved"]);

/**
 * What the threads panel shows first: a greeting and what needs the person, then one group per
 * status (questions first, closed work last), narrowed by the panel's search and filter. Waiting
 * on you and Resolved stay listed at zero, so a project with no thread yet reads the same as
 * one whose work is all done. Every row changes in place as entries arrive on the project's
 * stream.
 */
export const ThreadOverview = ({
  entry,
  filters,
}: {
  entry: ProjectEntry;
  filters: OverviewFilters;
}) => {
  const { project, threads, threadsLoaded, threadsError } = entry;

  if (!threadsLoaded && threadsError) {
    return (
      <ThreadsLoadError
        projectId={project.id}
        subject="this project's threads"
        error={threadsError}
        className="p-6 text-body"
      />
    );
  }

  if (!threadsLoaded) {
    return (
      <p data-testid="threads-loading" className="p-6 text-body text-text-subtle">
        Loading threads…
      </p>
    );
  }

  return <OverviewBody threads={threads} filters={filters} />;
};

const OverviewBody = ({
  threads,
  filters,
}: {
  threads: readonly Thread[];
  filters: OverviewFilters;
}) => {
  const { query, hidden } = filters;
  const greeting = greetingOf(useDisplayName(), threads);
  const visible = useMemo(
    () =>
      threads.filter(
        (thread) => !hidden.has(shownThreadStatus(thread)) && matchesThreadSearch(thread, query),
      ),
    [threads, query, hidden],
  );

  return (
    <div data-testid="thread-overview" className="flex flex-col gap-5 px-5 pb-6 pt-4">
      <Greeting greeting={greeting} waiting={attentionOf(threads).waiting} />
      {filters.searchOpen ? <SearchBox query={query} onChange={filters.setQuery} /> : null}
      <ResultCount shown={visible.length} total={threads.length} filters={filters} />
      {visible.length === 0 && threads.length > 0 ? (
        <p data-testid="threads-no-match" className="py-8 text-center text-body text-text-subtle">
          {query.trim() ? `No threads match “${query.trim()}”.` : "No threads match the filter."}
        </p>
      ) : (
        <Groups
          threads={visible}
          open={filters.active ? "all" : "default"}
          listed={filters.active ? [] : LISTED_AT_ZERO.filter((status) => !hidden.has(status))}
        />
      )}
    </div>
  );
};

/** How many threads the search and filter leave, with the way to drop them; plain text for a screen reader otherwise. */
const ResultCount = ({
  shown,
  total,
  filters,
}: {
  shown: number;
  total: number;
  filters: OverviewFilters;
}) =>
  filters.active ? (
    <div className="flex items-center justify-between text-meta text-text-subtle">
      <span data-testid="thread-count" className="tabular-nums">
        {shown} of {total}
      </span>
      <button
        type="button"
        data-testid="thread-filters-clear"
        onClick={filters.clear}
        className="rounded-row px-1 hover:text-text"
      >
        Clear
      </button>
    </div>
  ) : (
    <span data-testid="thread-count" className="sr-only">
      {total} {total === 1 ? "thread" : "threads"}
    </span>
  );

/** One section per status. `open: "all"` opens every one, so a match is never folded away. */
const Groups = ({
  threads,
  open,
  listed,
}: {
  threads: readonly Thread[];
  open: "all" | "default";
  /** Groups drawn even with no thread in them. */
  listed: readonly ThreadStatus[];
}) => {
  const [toggled, setToggled] = useState<ReadonlySet<ThreadStatus>>(new Set());
  const now = useNow();
  const groups = groupThreads(threads, listed);
  const isOpen = (status: ThreadStatus) =>
    open === "all" || COLLAPSED_BY_DEFAULT.has(status) === toggled.has(status);
  const toggle = (status: ThreadStatus) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  return (
    <div data-testid="thread-groups" className="flex flex-col gap-2.5">
      {groups.map(({ status, threads: inGroup }) => (
        <GroupSection
          key={status}
          status={status}
          count={inGroup.length}
          open={isOpen(status)}
          onToggle={() => toggle(status)}
        >
          {inGroup.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} now={now} />
          ))}
        </GroupSection>
      ))}
    </div>
  );
};

// Opened by the panel's search button, so the cursor goes straight in.
const SearchBox = ({ query, onChange }: { query: string; onChange: (query: string) => void }) => {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="relative w-full">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
      <Input
        ref={input}
        data-testid="thread-search"
        type="search"
        aria-label="Search threads"
        placeholder="Search threads"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 pl-8 text-meta md:text-meta"
      />
    </div>
  );
};

/** "Welcome back." (see `greetingOf`) and, under it, how many threads wait on the person; the groups below carry the rest of the counts. */
const Greeting = ({ greeting, waiting }: { greeting: string; waiting: number }) => (
  <div className="flex flex-col gap-1.5 px-1">
    <h2
      data-testid="overview-greeting"
      className="font-display text-greeting font-normal tracking-[-0.01em] break-words text-text"
    >
      {greeting}
    </h2>
    <p
      data-testid="project-attention"
      data-waiting={waiting}
      className={cn("text-body", waiting > 0 ? "text-waiting" : "text-text-subtle")}
    >
      {attentionSentence(waiting)}
    </p>
  </div>
);

const GROUP_BAR =
  "flex h-10 w-full items-center gap-2.5 rounded-row bg-hover px-3.5 text-body font-medium text-text";

const GroupSection = ({
  status,
  count,
  open,
  onToggle,
  children,
}: {
  status: ThreadStatus;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => {
  const noPermissionAsks = skipsPermissions(useAgentClis().data);
  return (
    <section data-testid="thread-group" data-status={status} data-open={open} data-count={count}>
      <h2>
        {count === 0 ? (
          <div data-testid="thread-group-label" className={GROUP_BAR}>
            <GroupLabel status={status} count={count} />
          </div>
        ) : (
          <button
            type="button"
            data-testid="thread-group-toggle"
            aria-expanded={open}
            onClick={onToggle}
            className={cn(GROUP_BAR, "transition-colors duration-[120ms] hover:bg-active")}
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn("size-4 text-text-subtle transition-transform", !open && "-rotate-90")}
            />
            <GroupLabel status={status} count={count} />
          </button>
        )}
      </h2>
      {count === 0 ? (
        <p data-testid="thread-group-hint" className="px-3.5 py-3 text-body text-text-subtle">
          {emptyGroupLine(status, noPermissionAsks)}
        </p>
      ) : null}
      {open && count > 0 ? <div className="flex flex-col gap-1 pt-1.5">{children}</div> : null}
    </section>
  );
};

const GroupLabel = ({ status, count }: { status: ThreadStatus; count: number }) => (
  <>
    {count === 0 ? <span aria-hidden="true" className="w-4" /> : null}
    <ThreadStatusDot status={status} />
    <span className={cn(status === "waiting-on-you" && "text-waiting")}>
      {THREAD_STATUS_LABEL[status]}
    </span>
    <span data-testid="thread-group-count" className="tabular-nums text-text-subtle">
      {count}
    </span>
  </>
);
