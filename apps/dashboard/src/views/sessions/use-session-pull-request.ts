import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatSessionSummary,
  type CreateSessionPrMode,
  type CreateSessionPullRequestResponse,
  createSessionPullRequest,
  getSessionPullRequestState,
  getSessionPullRequestStatus,
  type MergeSessionPrMethod,
  mergeSessionPullRequest,
  type SessionGitStatus,
  type SessionPullRequestState,
  type SessionPullRequestStatus,
} from "../../api/client";

export const SESSION_PR_POLL_INTERVAL_MS = 10_000;
export const SESSION_PR_TERMINAL_POLL_INTERVAL_MS = 60_000;

export interface SessionPullRequestController {
  /** Last fetched PR status; null until the first fetch resolves (or no PR is tracked). */
  status: SessionPullRequestStatus | null;
  /** True only while the very first fetch is in flight. */
  loading: boolean;
  creating: boolean;
  merging: boolean;
  refresh: () => Promise<void>;
  create: (mode: CreateSessionPrMode) => Promise<CreateSessionPullRequestResponse>;
  merge: (method: MergeSessionPrMethod) => Promise<SessionPullRequestStatus>;
}

interface UseSessionPullRequestOptions {
  /** Test seam; defaults to SESSION_PR_POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Slower poll that detects merges made on GitHub after checks settle. */
  terminalPollIntervalMs?: number;
}

/**
 * PR state for the active session. Tracking starts once git status knows a PR
 * exists (or one was created here, since git status can lag). Polls while the
 * PR is open with pending checks or unresolved mergeability and the tab is
 * visible. Pending checks use the fast cadence; settled checks use a slower
 * cadence so merges made directly on GitHub still appear without a focus event.
 */
export const useSessionPullRequest = (
  sessionId: string | null,
  gitStatus: SessionGitStatus | null,
  options: UseSessionPullRequestOptions = {},
): SessionPullRequestController => {
  const pollIntervalMs = options.pollIntervalMs ?? SESSION_PR_POLL_INTERVAL_MS;
  const terminalPollIntervalMs =
    options.terminalPollIntervalMs ?? SESSION_PR_TERMINAL_POLL_INTERVAL_MS;
  const [status, setStatus] = useState<SessionPullRequestStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);
  // A create/merge through this hook means a PR exists even before git status
  // catches up. State (not a ref) so tracking flips trigger a render reliably.
  const [localPrTracked, setLocalPrTracked] = useState(false);

  // Race guard: late responses for a previous session must never land.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Derived-state reset on session switch (no effect, no post-mount flash).
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setStatus(null);
    setLoading(false);
    setCreating(false);
    setMerging(false);
    setLocalPrTracked(false);
  }

  const tracked = Boolean(
    sessionId &&
      gitStatus?.isGitRepo &&
      !gitStatus.isOnDefaultBranch &&
      (gitStatus.pr !== null || localPrTracked),
  );

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const next = await getSessionPullRequestStatus(sessionId).catch(() => null);
    if (!next || sessionIdRef.current !== sessionId) return;
    if (next.pr) setLocalPrTracked(true);
    setStatus(next);
  }, [sessionId]);

  const gitPrNumber = gitStatus?.pr?.number ?? null;
  const gitPrState = gitStatus?.prState ?? null;

  // Initial fetch, and re-fetch when git status observes a different PR or a
  // PR state flip (e.g. an external merge picked up by a git-status refresh).
  useEffect(() => {
    // gitPrNumber/gitPrState are deliberate re-fetch signals, not values used inside.
    void gitPrNumber;
    void gitPrState;
    if (!tracked) return;
    let cancelled = false;
    if (statusRef.current === null) setLoading(true);
    void refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tracked, gitPrNumber, gitPrState, refresh]);

  const prState = status?.pr?.state ?? null;
  const checksState = status?.checksState ?? null;
  const mergeableUnknown = status?.pr?.mergeable === "UNKNOWN";

  useEffect(() => {
    const shouldPoll = prState === "OPEN";
    if (!sessionId || !shouldPoll) return;
    const activeIntervalMs =
      checksState === "pending" || mergeableUnknown ? pollIntervalMs : terminalPollIntervalMs;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };
    const start = () => {
      if (interval !== null || document.visibilityState !== "visible") return;
      interval = setInterval(() => void refresh(), activeIntervalMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    sessionId,
    prState,
    checksState,
    mergeableUnknown,
    refresh,
    pollIntervalMs,
    terminalPollIntervalMs,
  ]);

  const create = useCallback(
    async (mode: CreateSessionPrMode): Promise<CreateSessionPullRequestResponse> => {
      if (!sessionId) throw new Error("No active session");
      setCreating(true);
      try {
        const result = await createSessionPullRequest(sessionId, mode);
        if ("number" in result) {
          // Marks tracking; the tracked-flip effect performs the status fetch.
          setLocalPrTracked(true);
        }
        return result;
      } finally {
        if (sessionIdRef.current === sessionId) setCreating(false);
      }
    },
    [sessionId],
  );

  const merge = useCallback(
    async (method: MergeSessionPrMethod): Promise<SessionPullRequestStatus> => {
      if (!sessionId) throw new Error("No active session");
      setMerging(true);
      try {
        const next = await mergeSessionPullRequest(sessionId, method);
        if (sessionIdRef.current === sessionId) {
          setLocalPrTracked(true);
          setStatus(next);
        }
        return next;
      } finally {
        if (sessionIdRef.current === sessionId) setMerging(false);
      }
    },
    [sessionId],
  );

  const visibleStatus = tracked ? status : null;
  return useMemo(
    () => ({ status: visibleStatus, loading, creating, merging, refresh, create, merge }),
    [visibleStatus, loading, creating, merging, refresh, create, merge],
  );
};

export const SIDEBAR_PR_POLL_INTERVAL_MS = 60_000;

/** Lightweight PR states used to auto-settle closed or merged sidebar threads. */
export const useSidebarPullRequestStates = (
  sessions: ChatSessionSummary[],
  activeSessionId: string | null,
  activePrState: SessionPullRequestState | null,
  pollIntervalMs = SIDEBAR_PR_POLL_INTERVAL_MS,
): ReadonlyMap<string, SessionPullRequestState | null> => {
  const targetKey = useMemo(
    () =>
      sessions
        .filter((session) => session.repoId !== null && session.id !== activeSessionId)
        .map((session) => session.id)
        .sort()
        .join(","),
    [activeSessionId, sessions],
  );
  const targetIds = useMemo(() => (targetKey ? targetKey.split(",") : []), [targetKey]);
  const [states, setStates] = useState<Record<string, SessionPullRequestState | null>>({});
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    const results = await mapWithConcurrency(targetIds, 4, loadSidebarPullRequestState);
    if (generationRef.current !== generation) return;
    setStates((current) => mergeSidebarPullRequestStates(current, results));
  }, [targetIds]);

  useEffect(() => {
    generationRef.current += 1;
    if (targetIds.length === 0) {
      setStates({});
      return;
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };
    const start = () => {
      if (document.visibilityState !== "visible" || interval !== null) return;
      void refresh();
      interval = setInterval(() => void refresh(), pollIntervalMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    return () => {
      generationRef.current += 1;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, [pollIntervalMs, refresh, targetIds.length]);

  return useMemo(() => {
    const result = new Map<string, SessionPullRequestState | null>(Object.entries(states));
    if (activeSessionId) result.set(activeSessionId, activePrState);
    return result;
  }, [activePrState, activeSessionId, states]);
};

type SidebarPullRequestStateResult =
  | { sessionId: string; state: SessionPullRequestState | null; success: true }
  | { sessionId: string; state: null; success: false };

const loadSidebarPullRequestState = async (
  sessionId: string,
): Promise<SidebarPullRequestStateResult> => {
  try {
    const result = await getSessionPullRequestState(sessionId);
    return { sessionId, state: result.state, success: true };
  } catch {
    return { sessionId, state: null, success: false };
  }
};

const mergeSidebarPullRequestStates = (
  current: Record<string, SessionPullRequestState | null>,
  results: SidebarPullRequestStateResult[],
): Record<string, SessionPullRequestState | null> => {
  const next: Record<string, SessionPullRequestState | null> = {};
  for (const result of results) {
    if (result.success) next[result.sessionId] = result.state;
    else if (result.sessionId in current)
      next[result.sessionId] = current[result.sessionId] ?? null;
  }
  return next;
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapItem: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapItem(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
