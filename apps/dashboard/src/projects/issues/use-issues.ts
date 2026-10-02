import { ISSUE_PAGE_SIZE, type IssueList, type IssueStateFilter } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { listIssues } from "../../api/issues";

/** How often a visible Issues tab asks the host again. The host answers most from its cache. */
export const ISSUES_POLL_MS = 60_000;

export interface IssuesState {
  list: IssueList | null;
  /** The first read of this state filter is under way: nothing to show yet. */
  loading: boolean;
  /** A refresh the person asked for is under way; the list stays up. */
  refreshing: boolean;
  /** Why the last read failed, when it did. */
  error: string | null;
  limit: number;
  refresh: () => void;
  loadMore: () => void;
}

/**
 * The project's issues for a state filter, read through the host. Read again on Refresh, a page
 * further on Load more, and every minute while the page is visible, quietly: a background read
 * that fails keeps the list it has.
 */
export const useIssues = (
  projectId: string,
  state: IssueStateFilter,
  { pollMs = ISSUES_POLL_MS }: { pollMs?: number } = {},
): IssuesState => {
  const [list, setList] = useState<IssueList | null>(null);
  const [limit, setLimit] = useState(ISSUE_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Answers can arrive out of order; only the latest request may land.
  const latest = useRef(0);

  const read = useCallback(
    async (options: { refresh: boolean; quiet: boolean; limit: number }) => {
      const id = ++latest.current;
      const current = () => id === latest.current;
      if (!options.quiet) setRefreshing(true);
      const outcome = await listIssues(projectId, { state, ...options }).then(
        (next) => ({ next }),
        (cause: unknown) => ({ error: cause instanceof Error ? cause.message : String(cause) }),
      );
      if (!current()) return;
      if ("next" in outcome) {
        setList(outcome.next);
        setError(null);
      } else if (!options.quiet) {
        // A background read that fails keeps the list it has, without a word.
        setError(outcome.error);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [projectId, state],
  );

  // A new project or state filter starts over at the first page.
  useEffect(() => {
    setList(null);
    setLoading(true);
    setError(null);
    setLimit(ISSUE_PAGE_SIZE);
    void read({ refresh: false, quiet: false, limit: ISSUE_PAGE_SIZE });
  }, [read]);

  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void read({ refresh: false, quiet: true, limit: limitRef.current });
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [read, pollMs]);

  const refresh = useCallback(
    () => void read({ refresh: true, quiet: false, limit: limitRef.current }),
    [read],
  );
  const loadMore = useCallback(() => {
    const next = limitRef.current + ISSUE_PAGE_SIZE;
    setLimit(next);
    void read({ refresh: false, quiet: false, limit: next });
  }, [read]);

  return { list, loading, refreshing, error, limit, refresh, loadMore };
};
