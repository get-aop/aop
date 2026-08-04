/**
 * The one mutation barrier for chat sessions.
 *
 * Destructive maintenance (repo removal, factory reset) preflights chat history
 * and then deletes it. Without a barrier a send, retry, steer claim, workspace
 * change, or new session could land between those two steps and invalidate the
 * preflight, orphaning hidden checkpoint refs. Every mutating entry point asks
 * this module for permission first, and maintenance holds the affected session
 * locks from preflight through deletion.
 */

export type ChatSessionMutationKind =
  | "send"
  | "retry"
  | "steer-claim"
  | "workspace"
  | "create"
  | "delete"
  | "update";

export interface ChatSessionMutationTarget {
  sessionId?: string | null;
  repoId?: string | null;
}

export type MaintenanceScope = { kind: "repo"; repoId: string } | { kind: "global" };

export class SessionMutationBlockedError extends Error {
  readonly kind: ChatSessionMutationKind;
  readonly scope: MaintenanceScope["kind"];

  constructor(kind: ChatSessionMutationKind, scope: MaintenanceScope["kind"]) {
    super(
      scope === "global"
        ? `Chat ${kind} is blocked while a factory reset is in progress`
        : `Chat ${kind} is blocked while the repository is being removed`,
    );
    this.name = "SessionMutationBlockedError";
    this.kind = kind;
    this.scope = scope;
  }
}

export interface MaintenanceHandle {
  /** Sessions whose locks are held for the duration of the maintenance run. */
  sessionIds: string[];
}

export interface SessionMutationLock {
  /** Runs `task` while holding the given session locks, ordered by id to avoid deadlock. */
  withSessions: <T>(sessionIds: readonly string[], task: () => Promise<T>) => Promise<T>;
  /**
   * Blocks new chat mutations in `scope`, then enumerates and locks the
   * affected sessions. `loadSessionIds` runs after the barrier is up so a
   * session created mid-flight cannot escape the maintenance window.
   */
  withMaintenance: <T>(
    scope: MaintenanceScope,
    loadSessionIds: () => Promise<readonly string[]>,
    task: (handle: MaintenanceHandle) => Promise<T>,
  ) => Promise<T>;
  assertAllowed: (kind: ChatSessionMutationKind, target: ChatSessionMutationTarget) => void;
  isBlocked: (target: ChatSessionMutationTarget) => boolean;
}

interface LockState {
  tail: Promise<void>;
  waiters: number;
}

export const createSessionMutationLock = (): SessionMutationLock => {
  const locks = new Map<string, LockState>();
  const blockedRepoIds = new Map<string, number>();
  const blockedSessionIds = new Map<string, number>();
  let globalBarriers = 0;

  const acquire = async (key: string): Promise<() => void> => {
    const state = locks.get(key) ?? { tail: Promise.resolve(), waiters: 0 };
    state.waiters += 1;
    locks.set(key, state);

    const previous = state.tail;
    let release: () => void = () => undefined;
    state.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
      state.waiters -= 1;
      if (state.waiters === 0 && locks.get(key) === state) locks.delete(key);
    };
  };

  const withSessions = async <T>(
    sessionIds: readonly string[],
    task: () => Promise<T>,
  ): Promise<T> => {
    const ordered = [...new Set(sessionIds)].sort();
    const releases: Array<() => void> = [];
    try {
      for (const sessionId of ordered) releases.push(await acquire(sessionId));
      return await task();
    } finally {
      for (const release of releases.reverse()) release();
    }
  };

  const barrierScope = (target: ChatSessionMutationTarget): MaintenanceScope["kind"] | null => {
    if (globalBarriers > 0) return "global";
    if (target.repoId && blockedRepoIds.has(target.repoId)) return "repo";
    if (target.sessionId && blockedSessionIds.has(target.sessionId)) return "repo";
    return null;
  };

  return {
    withSessions,

    withMaintenance: async (scope, loadSessionIds, task) => {
      // Raise the barrier before enumerating so no new session for this scope
      // can appear, and before taking locks so work queued behind them cannot
      // slip in between preflight and deletion.
      if (scope.kind === "global") globalBarriers += 1;
      else increment(blockedRepoIds, scope.repoId);
      try {
        const ordered = [...new Set(await loadSessionIds())].sort();
        for (const sessionId of ordered) increment(blockedSessionIds, sessionId);
        try {
          return await withSessions(ordered, () => task({ sessionIds: ordered }));
        } finally {
          for (const sessionId of ordered) decrement(blockedSessionIds, sessionId);
        }
      } finally {
        if (scope.kind === "global") globalBarriers -= 1;
        else decrement(blockedRepoIds, scope.repoId);
      }
    },

    assertAllowed: (kind, target) => {
      const scope = barrierScope(target);
      if (scope) throw new SessionMutationBlockedError(kind, scope);
    },

    isBlocked: (target) => barrierScope(target) !== null,
  };
};

const increment = (counters: Map<string, number>, key: string): void => {
  counters.set(key, (counters.get(key) ?? 0) + 1);
};

const decrement = (counters: Map<string, number>, key: string): void => {
  const next = (counters.get(key) ?? 0) - 1;
  if (next <= 0) counters.delete(key);
  else counters.set(key, next);
};
