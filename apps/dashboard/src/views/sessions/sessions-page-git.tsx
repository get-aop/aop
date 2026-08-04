// Derived from T3 Code (https://github.com/pingdotgg/t3code), MIT, Copyright (c) 2026 T3 Tools Inc.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatSessionDetail,
  type ChatSessionSummary,
  createSessionWorktree,
  getSessionGitStatus,
  type SessionGitStatus,
  type SessionPullRequestState,
} from "../../api/client";
import type { RailRepoGroup } from "../../shell/rail-store";
import { MergedPrBar } from "./MergedPrBar";
import { SessionGitPrControls } from "./SessionGitPrControls";
import type { SessionToastContent, SessionToastLink } from "./SessionModals";
import { dismissMergedPrBar, useMergedPrBarDismissed } from "./session-merged-pr-dismissal";
import { isSessionSettled } from "./session-settled";
import type { MenuState, SessionsRepo } from "./sessions-menu";
import {
  type SessionPullRequestController,
  useSessionPullRequest,
  useSidebarPullRequestStates,
} from "./use-session-pull-request";

export const SESSION_GIT_STATUS_CACHE_MS = 15_000;
export const SESSION_GIT_STATUS_DELAY_MS = 100;

export type CachedSessionGitStatus = {
  status: SessionGitStatus;
  fetchedAt: number;
  requestId: number;
};

export type SessionGitStatusRequest = {
  requestId: number;
  promise: Promise<SessionGitStatus>;
};

/** Refreshes on workspace change, stale focus, and exactly once after a run finishes. */
export const useLiveSessionGitStatus = (
  sessionId: string | undefined,
  workspacePath: string | undefined,
  assistantActive: boolean,
  refreshToken = 0,
): SessionGitStatus | null => {
  // Key by session so two chats on the same repo path never share branch/diff status.
  const statusKey =
    sessionId && workspacePath ? `${sessionId}:${workspacePath}:${refreshToken}` : null;
  const cacheRef = useRef(new Map<string, CachedSessionGitStatus>());
  const requestsRef = useRef(new Map<string, SessionGitStatusRequest>());
  const requestSequenceRef = useRef(0);
  const assistantActiveRef = useRef(assistantActive);
  const previousRun = useRef({ sessionId, active: assistantActive });
  const [snapshot, setSnapshot] = useState<{
    key: string;
    status: SessionGitStatus;
  } | null>(null);
  assistantActiveRef.current = assistantActive;

  const requestStatus = useCallback(
    (key: string, id: string, force: boolean): SessionGitStatusRequest => {
      const requestKey = force ? `${key}:force` : key;
      const existing = requestsRef.current.get(requestKey);
      if (existing) return existing;

      const pending = force ? requestsRef.current.get(key)?.promise : null;
      const request: SessionGitStatusRequest = {
        requestId: ++requestSequenceRef.current,
        promise: pending
          ? pending.catch(() => undefined).then(() => getSessionGitStatus(id))
          : getSessionGitStatus(id),
      };
      requestsRef.current.set(requestKey, request);
      const cleanup = () => {
        if (requestsRef.current.get(requestKey) === request) {
          requestsRef.current.delete(requestKey);
        }
      };
      void request.promise.then(cleanup, cleanup);
      return request;
    },
    [],
  );

  const commitStatus = useCallback(
    (key: string, request: SessionGitStatusRequest, status: SessionGitStatus, visible: boolean) => {
      const cached = cacheRef.current.get(key);
      if (cached && cached.requestId > request.requestId) return;
      cacheRef.current.set(key, {
        status,
        fetchedAt: Date.now(),
        requestId: request.requestId,
      });
      if (visible) setSnapshot({ key, status });
    },
    [],
  );

  useEffect(() => {
    if (!sessionId || !statusKey) return;

    let cancelled = false;
    const refreshStatus = (force = false) => {
      const request = requestStatus(statusKey, sessionId, force);
      void request.promise
        .then((status) => commitStatus(statusKey, request, status, !cancelled))
        .catch(() => {
          // Keep the last known status during a transient refresh failure.
        });
    };
    const cached = cacheRef.current.get(statusKey);
    const cacheIsFresh = isFreshSessionGitStatus(cached);
    if (cached) setSnapshot({ key: statusKey, status: cached.status });
    const timeoutId =
      cacheIsFresh || assistantActiveRef.current
        ? null
        : window.setTimeout(() => {
            if (!assistantActiveRef.current) refreshStatus();
          }, SESSION_GIT_STATUS_DELAY_MS);
    const handleFocus = () => {
      if (assistantActiveRef.current || isFreshSessionGitStatus(cacheRef.current.get(statusKey))) {
        return;
      }
      refreshStatus();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [commitStatus, requestStatus, sessionId, statusKey]);

  useEffect(() => {
    const previous = previousRun.current;
    previousRun.current = { sessionId, active: assistantActive };
    if (
      !sessionId ||
      !statusKey ||
      previous.sessionId !== sessionId ||
      !previous.active ||
      assistantActive
    ) {
      return;
    }

    let cancelled = false;
    const request = requestStatus(statusKey, sessionId, true);
    void request.promise
      .then((status) => commitStatus(statusKey, request, status, !cancelled))
      .catch(() => {
        // Keep the last known status during a transient refresh failure.
      });
    return () => {
      cancelled = true;
    };
  }, [assistantActive, commitStatus, requestStatus, sessionId, statusKey]);

  return snapshot?.key === statusKey
    ? snapshot.status
    : (statusKey && cacheRef.current.get(statusKey)?.status) || null;
};

export const isFreshSessionGitStatus = (cached: CachedSessionGitStatus | undefined): boolean =>
  Boolean(cached && Date.now() - cached.fetchedAt < SESSION_GIT_STATUS_CACHE_MS);

export const useSessionRailData = (input: {
  repos: SessionsRepo[];
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  activePullRequestState: SessionPullRequestState | null;
  settlementNow: string;
}) => {
  const pullRequestCandidates = useMemo(
    () =>
      input.sessions.filter(
        (session) =>
          session.repoId !== null &&
          Boolean(session.branch) &&
          session.settledOverride === null &&
          !isSessionSettled(session, { now: input.settlementNow }),
      ),
    [input.sessions, input.settlementNow],
  );
  const sidebarPullRequestStates = useSidebarPullRequestStates(
    pullRequestCandidates,
    input.activeSessionId,
    input.activePullRequestState,
  );
  const settledSessionIds = useMemo(
    () =>
      new Set(
        input.sessions
          .filter((session) =>
            isSessionSettled(session, {
              now: input.settlementNow,
              pullRequestState: sidebarPullRequestStates.get(session.id),
            }),
          )
          .map((session) => session.id),
      ),
    [input.sessions, input.settlementNow, sidebarPullRequestStates],
  );
  const groups: RailRepoGroup[] = useMemo(
    () =>
      input.repos.map((repo) => ({
        repoId: repo.id,
        name: repo.name ?? repo.path.split("/").pop() ?? repo.id,
        sessions: input.sessions.filter(
          (session) => session.repoId === repo.id && !settledSessionIds.has(session.id),
        ),
      })),
    [input.repos, input.sessions, settledSessionIds],
  );
  const settled = useMemo(
    () => input.sessions.filter((session) => settledSessionIds.has(session.id)),
    [input.sessions, settledSessionIds],
  );
  const generalTasks = useMemo(
    () =>
      input.sessions.filter(
        (session) => session.scope === "general" && !settledSessionIds.has(session.id),
      ),
    [input.sessions, settledSessionIds],
  );
  return { sidebarPullRequestStates, groups, settled, generalTasks };
};

export const MINUTE_MS = 60_000;

export const useMinuteTimestamp = (): string => {
  const [now, setNow] = useState(() => currentMinuteTimestamp());
  useEffect(() => {
    const interval = setInterval(() => setNow(currentMinuteTimestamp()), MINUTE_MS);
    return () => clearInterval(interval);
  }, []);
  return now;
};

export const currentMinuteTimestamp = (): string =>
  new Date(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS).toISOString();

export const sessionPullRequestState = (
  pullRequest: SessionPullRequestController,
  gitStatus: SessionGitStatus | null,
): SessionPullRequestState | null => {
  const state = pullRequest.status?.pr?.state;
  if (state === "OPEN") return "open";
  if (state === "CLOSED") return "closed";
  if (state === "MERGED") return "merged";
  return gitStatus?.prState ?? null;
};

export const sessionIdForRail = (session: ChatSessionDetail | null): string | null =>
  session?.id ?? null;

export const pullRequestStateForMenu = (
  menu: MenuState,
  pullRequestStates: ReadonlyMap<string, SessionPullRequestState | null>,
): SessionPullRequestState | null => {
  if (menu.kind !== "sessmenu" || !menu.sessionId) return null;
  return pullRequestStates.get(menu.sessionId) ?? null;
};

/**
 * Owns the session PR controller and derives the two composer slots (git-bar
 * controls + merged-PR bar) so the page component stays flat.
 */
export const useSessionPrComposerSlots = (
  sessionId: string | null | undefined,
  gitStatus: SessionGitStatus | null,
  onToast: (message: string, link?: SessionToastLink) => void,
  onChanged: () => void,
): {
  gitPrControls: ReactNode;
  mergedPrBar: ReactNode;
  pullRequest: SessionPullRequestController;
} => {
  const id = sessionId ?? null;
  const sessionPullRequest = useSessionPullRequest(id, gitStatus);
  const status = sessionPullRequest.status;
  const mergedPr = status?.pr?.state === "MERGED" ? status.merged : null;
  const mergedPrDismissed = useMergedPrBarDismissed(id, mergedPr?.number ?? null);

  // PR controls live primarily in the workspace top bar (t3code ChatHeader);
  // keep the composer slot for location-strip adjacency when dirty.
  const gitPrControls = gitStatus?.isGitRepo ? (
    <SessionGitPrControls
      gitStatus={gitStatus}
      pr={sessionPullRequest}
      onToast={onToast}
      onChanged={onChanged}
    />
  ) : null;

  const mergedPrBar =
    mergedPr && !mergedPrDismissed ? (
      <MergedPrBar
        merged={mergedPr}
        branch={status?.pr?.headRefName ?? null}
        onDismiss={() => {
          if (id) dismissMergedPrBar(id, mergedPr.number);
        }}
      />
    ) : null;

  return { gitPrControls, mergedPrBar, pullRequest: sessionPullRequest };
};

export const toastContent = (message: string, link?: SessionToastLink): SessionToastContent =>
  link ? { message, link } : { message };

export const diffstatForComposer = (
  status: SessionGitStatus | null,
): SessionGitStatus["diffstat"] | null =>
  status?.isGitRepo && !status.isOnDefaultBranch ? status.diffstat : null;

export const worktreeCreateHandler = (
  repoId: string | null | undefined,
  sessionId: string,
  create: (sessionId: string, branchName: string) => Promise<void>,
): ((branchName: string) => Promise<void>) | undefined => {
  if (!repoId) return undefined;
  return (branchName) => create(sessionId, branchName);
};

export const createSessionWorktreeForComposer = async (input: {
  sessionId: string;
  branchName: string;
  showToast: (message: string) => void;
  reloadDetailQuiet: (sessionId: string) => Promise<unknown>;
  refreshList: () => Promise<unknown>;
  onWorkspaceChanged: () => void;
}): Promise<void> => {
  try {
    const result = await createSessionWorktree(input.sessionId, { branchName: input.branchName });
    input.showToast(`Worktree ready on ${result.worktree.branch}`);
    await Promise.all([input.reloadDetailQuiet(input.sessionId), input.refreshList()]);
    input.onWorkspaceChanged();
  } catch (error: unknown) {
    input.showToast(error instanceof Error ? error.message : "Could not create session worktree");
    throw error;
  }
};
