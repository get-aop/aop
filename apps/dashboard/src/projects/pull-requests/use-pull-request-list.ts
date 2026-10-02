import type {
  PullRequestListItem,
  PullRequestListQueryInput,
  PullRequestListResponse,
} from "@aop/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listPullRequests } from "../../api/pull-requests";
import type { PullRequestFilters } from "./pull-request-filters";

export type ReadyList = Extract<PullRequestListResponse, { status: "ready" }>;

export interface PullRequestList {
  /** Nothing to show yet: the first read is under way. */
  loading: boolean;
  /** The last answer, with every page loaded so far in `items`. */
  response: PullRequestListResponse | null;
  items: PullRequestListItem[];
  /** Why the last read failed (the last good answer stays shown). */
  error: string | null;
  /** A read is under way while something is shown: a new filter, a refresh, a poll. */
  refreshing: boolean;
  loadingMore: boolean;
  refresh: () => void;
  loadMore: () => void;
}

export interface PullRequestListOptions {
  /** How long the search waits for typing to stop before it asks the host. */
  debounceMs?: number;
  /** How often the list is read again while the page is visible. */
  pollMs?: number;
  list?: typeof listPullRequests;
}

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * The project's pull requests for the filters. A new filter reads the first page again (the
 * search after typing stops); Refresh asks the host to read GitHub again; and while the page is
 * visible the list is read again every minute, from the host's cache unless GitHub changed.
 * An answer that arrives after a newer request was made is dropped.
 */
export const usePullRequestList = (
  projectId: string,
  filters: PullRequestFilters,
  { debounceMs = 250, pollMs = 60_000, list = listPullRequests }: PullRequestListOptions = {},
): PullRequestList => {
  const [state, setState] = useState<ListState>(INITIAL);
  const latest = useRef(0);
  const loaded = useRef(0);
  loaded.current = state.items.length;
  const query = useDebouncedQuery(filters, debounceMs);

  const read = useCallback(
    async (kind: Pending, extra: Partial<PullRequestListQueryInput>) => {
      const id = ++latest.current;
      setState((current) => ({ ...current, pending: kind }));
      const outcome = await settle(list(projectId, { ...query, ...extra }));
      if (id === latest.current) setState((current) => withOutcome(current, kind, outcome));
    },
    [list, projectId, query],
  );

  // What is shown is read again whole: as many as were loaded, at least a page.
  const reread = useCallback(
    (refresh: boolean) =>
      read("first", {
        limit: Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, loaded.current)),
        refresh,
      }),
    [read],
  );

  useEffect(() => {
    void read("first", { limit: PAGE_SIZE });
  }, [read]);

  usePolling(() => void reread(false), pollMs);

  const { response, items, error, pending } = state;
  const nextCursor = response?.status === "ready" ? response.nextCursor : null;
  return {
    loading: response === null && error === null,
    response,
    items,
    error,
    refreshing: pending === "first" && response !== null,
    loadingMore: pending === "more",
    refresh: () => void reread(true),
    loadMore: () => {
      if (nextCursor && pending === null)
        void read("more", { cursor: nextCursor, limit: PAGE_SIZE });
    },
  };
};

type Pending = "first" | "more";

interface ListState {
  response: PullRequestListResponse | null;
  items: PullRequestListItem[];
  error: string | null;
  pending: Pending | null;
}

const INITIAL: ListState = { response: null, items: [], error: null, pending: "first" };

type Outcome = { answer: PullRequestListResponse } | { error: string };

const settle = async (reading: Promise<PullRequestListResponse>): Promise<Outcome> => {
  try {
    return { answer: await reading };
  } catch (caught) {
    return { error: messageOf(caught) };
  }
};

/** A first page replaces what is shown, a further page adds to it; a failure keeps it and says why. */
const withOutcome = (state: ListState, kind: Pending, outcome: Outcome): ListState => {
  if ("error" in outcome) return { ...state, error: outcome.error, pending: null };
  const page = outcome.answer.status === "ready" ? outcome.answer.items : [];
  return {
    response: outcome.answer,
    items: kind === "more" ? [...state.items, ...page] : page,
    error: null,
    pending: null,
  };
};

/** The filters as a query, the search held back until typing stops for `delayMs`. */
const useDebouncedQuery = (
  filters: PullRequestFilters,
  delayMs: number,
): PullRequestListQueryInput => {
  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    if (filters.q === q) return;
    const timer = setTimeout(() => setQ(filters.q), delayMs);
    return () => clearTimeout(timer);
  }, [filters.q, q, delayMs]);
  const { state, author, label, assignee, sort, involves } = filters;
  // Keyed by value, so filters rebuilt with the same values read nothing again.
  const key = JSON.stringify({ state, author, label, assignee, q: q.trim(), sort, involves });
  return useMemo(() => JSON.parse(key) as PullRequestListQueryInput, [key]);
};

/** Calls `poll` every `intervalMs` while the page is visible, and at once when it shows again after one was missed. */
const usePolling = (poll: () => void, intervalMs: number) => {
  const latestPoll = useRef(poll);
  latestPoll.current = poll;
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      latestPoll.current();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= intervalMs) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "The host could not list the pull requests.";
