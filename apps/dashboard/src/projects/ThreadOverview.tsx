import type { Thread, ThreadStatus } from "@aop/common";
import { ChevronDownIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import type { OverviewFilters } from "./layout/use-overview-filters";
import type { ProjectEntry } from "./projects-state";
import {
  attentionOf,
  attentionSentence,
  groupThreads,
  matchesThreadSearch,
  type OverviewCounters,
  overviewCounters,
  THREAD_STATUS_LABEL,
} from "./selectors";
import { ThreadCard } from "./ThreadCard";
import { ThreadStatusDot } from "./ThreadStatusDot";
import { ThreadsLoadError } from "./ThreadsLoadError";
import { useNow } from "./use-now";

// Closed work is out of the way until asked for; everything else is what the person may need.
const COLLAPSED_BY_DEFAULT: ReadonlySet<ThreadStatus> = new Set(["resolved"]);

/**
 * What the threads panel shows first: a greeting and what needs the person, then one group per
 * status (questions first, closed work last), narrowed by the panel's search and filter. Every
 * row changes in place as entries arrive on the project's stream.
 */
export const ThreadOverview = ({
  entry,
  filters,
  onNewThread,
}: {
  entry: ProjectEntry;
  filters: OverviewFilters;
  /** Takes the person to where a thread is started: the coordinator's composer. */
  onNewThread: () => void;
}) => {
  const { project, threads, threadsLoaded, threadsError } = entry;

  if (!threadsLoaded && threadsError) {
    return (
      <ThreadsLoadError
        projectId={project.id}
        subject="this project's threads"
        error={threadsError}
        className="p-6 text-[13px]"
      />
    );
  }

  if (!threadsLoaded) {
    return (
      <p data-testid="threads-loading" className="p-6 text-[13px] text-text-subtle">
        Loading threads…
      </p>
    );
  }

  if (threads.length === 0) return <NoThreads onNewThread={onNewThread} />;
  return <OverviewBody threads={threads} filters={filters} />;
};

const NoThreads = ({ onNewThread }: { onNewThread: () => void }) => (
  <div
    data-testid="threads-empty"
    className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
  >
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[14px] font-medium text-text">No threads yet</h2>
      <p
        data-testid="project-attention"
        data-waiting={0}
        className="text-[12.5px] text-text-subtle"
      >
        {attentionSentence(0)}
      </p>
      <p className="max-w-sm text-[13px] text-text-subtle">
        Tell the coordinator what you want done. It starts a thread for each piece of work and
        reports back here.
      </p>
    </div>
    <Button size="sm" data-testid="threads-empty-chat" onClick={onNewThread}>
      <MessageSquareIcon />
      Talk to the coordinator
    </Button>
  </div>
);

const OverviewBody = ({
  threads,
  filters,
}: {
  threads: readonly Thread[];
  filters: OverviewFilters;
}) => {
  const { query, hidden } = filters;
  const visible = useMemo(
    () =>
      threads.filter((thread) => !hidden.has(thread.status) && matchesThreadSearch(thread, query)),
    [threads, query, hidden],
  );
  const counters = useMemo(() => overviewCounters(threads), [threads]);

  return (
    <div data-testid="thread-overview" className="flex flex-col gap-4 px-4 pb-6 pt-3">
      <Greeting waiting={attentionOf(threads).waiting} counters={counters} />
      {filters.searchOpen ? <SearchBox query={query} onChange={filters.setQuery} /> : null}
      <ResultCount shown={visible.length} total={threads.length} filters={filters} />
      {visible.length === 0 ? (
        <p data-testid="threads-no-match" className="py-8 text-center text-[13px] text-text-subtle">
          {query.trim() ? `No threads match “${query.trim()}”.` : "No threads match the filter."}
        </p>
      ) : (
        <Groups threads={visible} open={filters.active ? "all" : "default"} />
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
    <div className="flex items-center justify-between text-[12px] text-text-subtle">
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
const Groups = ({ threads, open }: { threads: readonly Thread[]; open: "all" | "default" }) => {
  const [toggled, setToggled] = useState<ReadonlySet<ThreadStatus>>(new Set());
  const now = useNow();
  const groups = useMemo(() => groupThreads(threads), [threads]);
  const isOpen = (status: ThreadStatus) =>
    open === "all" || COLLAPSED_BY_DEFAULT.has(status) === toggled.has(status);
  const toggle = (status: ThreadStatus) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  return (
    <div data-testid="thread-groups" className="flex flex-col gap-2">
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
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  );
};

/** "Welcome back." and, under it, how many threads wait on the person, then the project in five numbers. */
const Greeting = ({ waiting, counters }: { waiting: number; counters: OverviewCounters }) => (
  <div className="flex flex-col gap-1 px-1">
    <h2
      data-testid="overview-greeting"
      className="text-[26px] font-semibold leading-tight text-text"
    >
      Welcome back.
    </h2>
    <p
      data-testid="project-attention"
      data-waiting={waiting}
      className={cn("text-[14px]", waiting > 0 ? "text-waiting" : "text-text-subtle")}
    >
      {attentionSentence(waiting)}
    </p>
    <Counters counters={counters} />
  </div>
);

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
}) => (
  <section data-testid="thread-group" data-status={status} data-open={open}>
    <h2>
      <button
        type="button"
        data-testid="thread-group-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 rounded-row bg-hover px-3 text-[13.5px] font-medium text-text transition-colors duration-[120ms] hover:bg-active"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("size-3.5 text-text-subtle transition-transform", !open && "-rotate-90")}
        />
        <ThreadStatusDot status={status} />
        <span className={cn(status === "waiting-on-you" && "text-waiting")}>
          {THREAD_STATUS_LABEL[status]}
        </span>
        <span data-testid="thread-group-count" className="tabular-nums text-text-subtle">
          {count}
        </span>
      </button>
    </h2>
    {open ? <div className="flex flex-col gap-0.5 pt-1">{children}</div> : null}
  </section>
);

const COUNTERS: { key: keyof OverviewCounters; label: string }[] = [
  { key: "waiting", label: "Waiting on you" },
  { key: "running", label: "Running" },
  { key: "readyForReview", label: "Ready for review" },
  { key: "openPullRequests", label: "Open pull requests" },
  { key: "resolved", label: "Resolved" },
];

/** The project in five numbers: what needs the person, what runs, what waits, what is open, what is done. */
const Counters = ({ counters }: { counters: OverviewCounters }) => (
  <dl data-testid="overview-counters" className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
    {COUNTERS.map(({ key, label }) => (
      <div
        key={key}
        data-testid="overview-counter"
        data-counter={key}
        data-value={counters[key]}
        className="flex items-baseline gap-1.5"
      >
        <dd
          className={cn(
            "text-[13px] font-semibold tabular-nums text-text-muted",
            key === "waiting" && counters.waiting > 0 && "text-waiting",
          )}
        >
          {counters[key]}
        </dd>
        <dt className="text-[11.5px] text-text-subtle">{label}</dt>
      </div>
    ))}
  </dl>
);
