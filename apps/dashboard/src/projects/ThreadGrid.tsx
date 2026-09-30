import { MessageSquareIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { coordinatorPath, Link } from "../shell/router";
import type { ProjectEntry } from "./projects-state";
import { matchesThreadSearch, sortThreads } from "./selectors";
import { ThreadCard } from "./ThreadCard";
import { useNow } from "./use-now";

/**
 * The project home: every thread as a card, the ones that need the person first, with search.
 * The grid re-renders as entries arrive on the project's stream, so a card changes in place.
 */
export const ThreadGrid = ({ entry }: { entry: ProjectEntry }) => {
  const [query, setQuery] = useState("");
  const now = useNow();
  const { project, threads, threadsLoaded } = entry;
  const visible = useMemo(
    () => sortThreads(threads).filter((thread) => matchesThreadSearch(thread, query)),
    [threads, query],
  );

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

  return (
    <div className="flex flex-col gap-4 p-6">
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
      {visible.length === 0 ? (
        <p data-testid="threads-no-match" className="py-8 text-center text-[13px] text-text-subtle">
          No threads match “{query.trim()}”.
        </p>
      ) : (
        <div
          data-testid="thread-grid"
          className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
        >
          {visible.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} now={now} />
          ))}
        </div>
      )}
    </div>
  );
};
