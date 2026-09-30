import type { ThreadStatus } from "@aop/common";
import { ChevronDownIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { coordinatorPath, Link } from "../shell/router";
import type { ProjectEntry } from "./projects-state";
import {
  groupThreads,
  matchesThreadSearch,
  type OverviewCounters,
  overviewCounters,
  THREAD_STATUS_LABEL,
} from "./selectors";
import { ThreadCard } from "./ThreadCard";
import { ThreadStatusDot } from "./ThreadStatusDot";
import { useNow } from "./use-now";

// Closed work is out of the way until asked for; everything else is what the person may need.
const COLLAPSED_BY_DEFAULT: ReadonlySet<ThreadStatus> = new Set(["resolved"]);

/**
 * The project home: what needs the person first, then what is running, what waits for
 * review, and what is done, as one group per status with search. Every card changes in place
 * as entries arrive on the project's stream.
 */
export const ThreadOverview = ({ entry }: { entry: ProjectEntry }) => {
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<ReadonlySet<ThreadStatus>>(new Set());
  const now = useNow();
  const { project, threads, threadsLoaded } = entry;
  const searching = query.trim() !== "";
  const visible = useMemo(
    () => threads.filter((thread) => matchesThreadSearch(thread, query)),
    [threads, query],
  );
  const groups = useMemo(() => groupThreads(visible), [visible]);
  const counters = useMemo(() => overviewCounters(threads), [threads]);

  if (!threadsLoaded) {
    return (
      <p data-testid="threads-loading" className="p-6 text-[13px] text-text-subtle">
        Loading threads…
      </p>
    );
  }

  if (threads.length === 0) {
    return (
      <div
        data-testid="threads-empty"
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[14px] font-medium text-text">No threads yet</h2>
          <p className="max-w-sm text-[13px] text-text-subtle">
            Tell the coordinator what you want done. It starts a thread for each piece of work and
            reports back here.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to={coordinatorPath(project.id)} data-testid="threads-empty-chat">
            <MessageSquareIcon />
            Talk to the coordinator
          </Link>
        </Button>
      </div>
    );
  }

  const isOpen = (status: ThreadStatus) =>
    searching || COLLAPSED_BY_DEFAULT.has(status) === toggled.has(status);
  const toggle = (status: ThreadStatus) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  return (
    <div data-testid="thread-overview" className="flex flex-col gap-5 p-6">
      <Counters counters={counters} />
      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
          <Input
            data-testid="thread-search"
            type="search"
            aria-label="Search threads"
            placeholder="Search threads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <span data-testid="thread-count" className="text-[12px] tabular-nums text-text-subtle">
          {visible.length === threads.length
            ? `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`
            : `${visible.length} of ${threads.length}`}
        </span>
      </div>
      {groups.length === 0 ? (
        <p data-testid="threads-no-match" className="py-8 text-center text-[13px] text-text-subtle">
          No threads match “{query.trim()}”.
        </p>
      ) : (
        <div data-testid="thread-groups" className="flex flex-col gap-5">
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
      )}
    </div>
  );
};

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
    <h2 className="mb-2">
      <button
        type="button"
        data-testid="thread-group-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-2 rounded-row px-1 py-0.5 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:text-text"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
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
    {open ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">{children}</div>
    ) : null}
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
  <dl data-testid="overview-counters" className="flex flex-wrap gap-x-8 gap-y-3">
    {COUNTERS.map(({ key, label }) => (
      <div
        key={key}
        data-testid="overview-counter"
        data-counter={key}
        data-value={counters[key]}
        className="flex min-w-24 flex-col gap-0.5"
      >
        <dd
          className={cn(
            "text-[22px] font-semibold leading-none tabular-nums text-text",
            key === "waiting" && counters.waiting > 0 && "text-waiting",
          )}
        >
          {counters[key]}
        </dd>
        <dt className="text-[12px] text-text-subtle">{label}</dt>
      </div>
    ))}
  </dl>
);
