import type { PullRequestViewDetail } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPullRequestChecks,
  getPullRequestView,
  type PullRequestKey,
} from "../../api/pull-request-view";

/** While checks run (or GitHub works out mergeability), how often the page asks again. */
export const ACTIVE_POLL_MS = 10_000;
/** An open pull request with nothing running is asked again now and then, for new reviews. */
export const IDLE_POLL_MS = 60_000;

export interface PullRequestViewData {
  detail: PullRequestViewDetail | null;
  /** Why the first read failed; a later failed refresh keeps the page and says so in `stale`. */
  error: Error | null;
  /** A refresh after the page loaded failed: what is shown may be out of date. */
  stale: Error | null;
  loading: boolean;
  refreshing: boolean;
  /** Reads GitHub again now, past the host's few-second cache. */
  refresh: () => Promise<void>;
  /** Runs a write, then reads the page again; resolves to GitHub's refusal, if any. */
  act: (write: () => Promise<unknown>) => Promise<Error | null>;
}

/**
 * One pull request's page. Its checks are polled while the tab is visible: often while they
 * run, rarely once they settle, never once the pull request is merged or closed. Every read
 * sends the ETag of what it holds, so an unchanged page costs a 304.
 */
export const usePullRequestView = (key: PullRequestKey): PullRequestViewData => {
  const [detail, setDetailState] = useState<PullRequestViewDetail | null>(null);
  // What is on screen, for the reads below to compare against without waiting for a render.
  const shown = useRef<PullRequestViewDetail | null>(null);
  const setDetail = useCallback((next: PullRequestViewDetail | null) => {
    shown.current = next;
    setDetailState(next);
  }, []);
  const [error, setError] = useState<Error | null>(null);
  const [stale, setStale] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const etags = useRef<{ detail: string | null; checks: string | null }>({
    detail: null,
    checks: null,
  });
  const { projectId, repoId, number } = key;

  const load = useCallback(
    async (refresh: boolean) => {
      const target = { projectId, repoId, number };
      try {
        const read = await getPullRequestView(target, etags.current.detail, { refresh });
        if (read.changed) {
          etags.current.detail = read.etag;
          setDetail(read.value);
        }
        setError(null);
        setStale(null);
      } catch (failure) {
        // Before the page loaded, the failure is the page; after, it is a note on it.
        (shown.current ? setStale : setError)(asError(failure));
      }
    },
    [projectId, repoId, number, setDetail],
  );

  useEffect(() => {
    etags.current = { detail: null, checks: null };
    setDetail(null);
    setError(null);
    void load(false);
  }, [load, setDetail]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const pollChecks = useCallback(async () => {
    try {
      const read = await getPullRequestChecks({ projectId, repoId, number }, etags.current.checks);
      if (!read.changed) return;
      etags.current.checks = read.etag;
      const current = shown.current;
      if (!current) return;
      const checks = read.value;
      // A new head or a state change touches the whole page: commits, timeline, files.
      if (current.headSha !== checks.headSha || current.state !== checks.state) {
        await load(true);
        return;
      }
      setDetail({ ...current, checks: checks.checks, merge: checks.merge });
    } catch {
      // Polling is best effort; the next tick or a Refresh tries again.
    }
  }, [projectId, repoId, number, load, setDetail]);

  usePolling(pollIntervalOf(detail), pollChecks);

  const act = useCallback(
    async (write: () => Promise<unknown>): Promise<Error | null> => {
      try {
        await write();
        return null;
      } catch (failure) {
        return asError(failure);
      } finally {
        await load(true);
      }
    },
    [load],
  );

  return {
    detail,
    error,
    stale,
    loading: detail === null && error === null,
    refreshing,
    refresh,
    act,
  };
};

/** How often to poll: null when there is nothing to watch (closed, merged, not loaded). */
export const pollIntervalOf = (detail: PullRequestViewDetail | null): number | null => {
  if (detail?.state !== "open") return null;
  const busy =
    detail.checks.state === "pending" ||
    detail.merge.blockers.some((blocker) => blocker.kind === "computing");
  return busy ? ACTIVE_POLL_MS : IDLE_POLL_MS;
};

/** Calls `tick` every `intervalMs` while the page is visible; a hidden tab asks nothing. */
const usePolling = (intervalMs: number | null, tick: () => Promise<void>): void => {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (intervalMs === null) return;
    const run = () => {
      if (document.visibilityState === "visible") void tickRef.current();
    };
    const timer = window.setInterval(run, intervalMs);
    // Coming back to the tab is when the person looks: ask then rather than wait out the interval.
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [intervalMs]);
};

const asError = (failure: unknown): Error =>
  failure instanceof Error ? failure : new Error(String(failure));
