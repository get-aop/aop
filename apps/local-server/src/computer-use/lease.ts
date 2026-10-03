import type { CuaLeaseHolder, CuaLeaseState } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { CuaThread } from "./cua-activity.ts";
import { type ExternalLock, lockNamesThread } from "./external-lock.ts";

const logger = getLogger("computer-use");

/**
 * One thread at a time on the host's screen. A thread's CUA call asks for the lease; the first
 * gets it and the others wait in line, first come first served. The holder gives it back when it
 * calls `end_session`, when its turn ends (done, stopped or crashed), or after `IDLE_MS` without a
 * CUA call. Before the next in line gets it, `cleanup` ends what the last holder left open (its
 * CUA sessions, so their browsers close and their profiles go).
 *
 * A waiter whose call gave up waiting (see `acquire`'s `maxWaitMs`) keeps its place for
 * `RESERVATION_MS`, so calling again does not send it to the back. If its turn comes in the
 * meantime it gets the lease, and gives it back after `RESERVATION_MS` if it does not call.
 */
export interface CuaLease {
  /** Gives the lease at once when the thread holds it or nobody does and nobody waits. */
  tryAcquire: (thread: CuaThread) => boolean;
  /** Waits in line for the lease. */
  acquire: (thread: CuaThread, options: AcquireOptions) => Promise<AcquireResult>;
  /** Marks a CUA call of the holder as running, so the idle timeout never cuts it. */
  callStarted: (threadId: string) => void;
  callEnded: (threadId: string) => void;
  /** Gives the lease back (if the thread holds it) and runs the cleanup first. */
  release: (threadId: string, reason: ReleaseReason) => Promise<void>;
  /** The thread's turn ended: it gives back the lease and leaves the line. */
  runEnded: (threadId: string) => Promise<void>;
  state: () => CuaLeaseState;
  /** Where a waiting thread stands, or null when it is not in line. */
  waitOf: (threadId: string) => CuaLeaseWait | null;
  holderId: () => string | null;
  setCleanup: (cleanup: LeaseCleanup) => void;
  /** Stops the timer and gives back the lock directory (host shutdown). */
  stop: () => void;
}

export interface AcquireOptions {
  /** How long this call waits before it answers "still waiting" and keeps the place. */
  maxWaitMs: number;
  signal?: AbortSignal;
  /** Called with the waiter's place now and whenever it changes. */
  onWait?: (wait: CuaLeaseWait) => void;
}

export type AcquireResult =
  | { kind: "granted" }
  | { kind: "still-waiting"; wait: CuaLeaseWait }
  | { kind: "aborted" };

export interface CuaLeaseWait {
  position: number;
  holder: CuaLeaseHolder | null;
}

export type ReleaseReason = "end-session" | "run-ended" | "idle" | "reservation" | "shutdown";
export type LeaseCleanup = (threadId: string, reason: ReleaseReason) => Promise<void>;

export interface CuaLeaseDeps {
  externalLock?: ExternalLock | null;
  now?: () => number;
  every?: (ms: number, run: () => void) => () => void;
  idleMs?: number;
  reservationMs?: number;
  /** Bounds the cleanup, so a stuck driver never stalls the line. */
  cleanupTimeoutMs?: number;
}

export const IDLE_MS = 3 * 60_000;
export const RESERVATION_MS = 2 * 60_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const TICK_MS = 1_000;
const HEARTBEAT_MS = 60_000;

interface Holder {
  thread: CuaThread;
  since: number;
  lastCallAt: number;
  inFlight: number;
  /** How long it may stay without a call: shorter for a place granted to a reservation. */
  idleLimit: number;
  /** True when the host made the lock directory for this lease (and removes it after). */
  tookLock: boolean;
}

interface Waiter {
  thread: CuaThread;
  since: number;
  /** Calls waiting right now; each is woken with the outcome. */
  calls: Set<(outcome: "granted") => void>;
  listeners: Set<(wait: CuaLeaseWait) => void>;
  reservedUntil: number | null;
}

export const createCuaLease = (deps: CuaLeaseDeps = {}): CuaLease => {
  const now = deps.now ?? Date.now;
  const every = deps.every ?? defaultEvery;
  const idleMs = deps.idleMs ?? IDLE_MS;
  const reservationMs = deps.reservationMs ?? RESERVATION_MS;
  const cleanupTimeoutMs = deps.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
  const lock = deps.externalLock ?? null;
  let cleanup: LeaseCleanup = async () => {};
  let holder: Holder | null = null;
  let releasing: Promise<void> | null = null;
  let external: { owner: string | null; since: number } | null = null;
  let lastHeartbeat = 0;
  const queue: Waiter[] = [];

  const holderView = (): CuaLeaseHolder | null => {
    if (holder) {
      return {
        kind: "thread",
        threadId: holder.thread.id,
        projectId: holder.thread.projectId,
        title: holder.thread.title,
        since: iso(holder.since),
        lastCallAt: iso(holder.lastCallAt),
      };
    }
    return external
      ? { kind: "external", owner: external.owner, since: iso(external.since) }
      : null;
  };

  const waitOf = (threadId: string): CuaLeaseWait | null => {
    const index = queue.findIndex((waiter) => waiter.thread.id === threadId);
    return index < 0 ? null : { position: index + 1, holder: holderView() };
  };

  const notifyWaiters = () => {
    queue.forEach((waiter, index) => {
      const wait = { position: index + 1, holder: holderView() };
      for (const listener of waiter.listeners) listener(wait);
    });
  };

  // Whether the old lock directory lets `thread` have the screen; takes it for the host if so.
  const claimLock = (thread: CuaThread): { ok: boolean; tookLock: boolean } => {
    const claim = claimExternalLock(lock, thread);
    if (claim.kind === "held") {
      external = { owner: claim.owner, since: external?.since ?? claim.heartbeatAt };
      return { ok: false, tookLock: false };
    }
    return { ok: claim.kind !== "lost", tookLock: claim.kind === "took" };
  };

  const grant = (thread: CuaThread, idleLimit: number): boolean => {
    const claimed = claimLock(thread);
    if (!claimed.ok) return false;
    external = null;
    const at = now();
    holder = {
      thread,
      since: at,
      lastCallAt: at,
      inFlight: 0,
      idleLimit,
      tookLock: claimed.tookLock,
    };
    lastHeartbeat = at;
    logger.info("Computer use lease granted to thread {threadId} ({title})", {
      threadId: thread.id,
      title: thread.title,
    });
    return true;
  };

  const dropExpiredReservations = () => {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const waiter = queue[i];
      if (waiter && waiter.calls.size === 0 && (waiter.reservedUntil ?? 0) < now()) {
        queue.splice(i, 1);
      }
    }
  };

  const forgetFreedLock = () => {
    if (external && lock?.inspect().kind !== "held") external = null;
  };

  // Hands the lease to the first in line when nobody holds it.
  const pump = () => {
    if (holder || releasing) return;
    dropExpiredReservations();
    const next = queue[0];
    if (!next) {
      forgetFreedLock();
      return;
    }
    if (grant(next.thread, next.calls.size > 0 ? idleMs : reservationMs)) handOver(next);
    notifyWaiters();
  };

  // The first in line got the lease: it leaves the line and its waiting calls go through.
  const handOver = (next: Waiter) => {
    queue.shift();
    for (const wake of next.calls) wake("granted");
  };

  const release: CuaLease["release"] = async (threadId, reason) => {
    if (releasing) await releasing;
    if (!holder || holder.thread.id !== threadId) return;
    const leaving = holder;
    releasing = (async () => {
      logger.info("Computer use lease of thread {threadId} released ({reason})", {
        threadId,
        reason,
      });
      await withTimeout(cleanup(threadId, reason), cleanupTimeoutMs).catch((error) => {
        logger.warn("Computer use cleanup for thread {threadId} failed: {error}", {
          threadId,
          error: String(error),
        });
      });
      if (leaving.tookLock) lock?.release();
      holder = null;
    })();
    try {
      await releasing;
    } finally {
      releasing = null;
      pump();
    }
  };

  const idleHolder = (): Holder | null =>
    holder && holder.inFlight === 0 && now() - holder.lastCallAt > holder.idleLimit ? holder : null;

  const heartbeat = () => {
    if (!holder?.tookLock || now() - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = now();
    lock?.heartbeat();
  };

  const tick = () => {
    const idle = idleHolder();
    if (idle) {
      void release(idle.thread.id, idle.idleLimit === idleMs ? "idle" : "reservation");
      return;
    }
    heartbeat();
    if (!holder) pump();
  };
  const stopTicking = every(TICK_MS, tick);

  const enqueue = (thread: CuaThread): Waiter => {
    const found = queue.find((waiter) => waiter.thread.id === thread.id);
    if (found) {
      found.thread = thread;
      return found;
    }
    const waiter: Waiter = {
      thread,
      since: now(),
      calls: new Set(),
      listeners: new Set(),
      reservedUntil: null,
    };
    queue.push(waiter);
    return waiter;
  };

  const leaveQueue = (threadId: string) => {
    const index = queue.findIndex((waiter) => waiter.thread.id === threadId);
    if (index >= 0) queue.splice(index, 1);
  };

  return {
    tryAcquire: (thread) => {
      if (holder?.thread.id === thread.id) return true;
      if (holder || releasing) return false;
      dropExpiredReservations();
      const first = queue[0];
      if (first && first.thread.id !== thread.id) return false;
      if (!grant(thread, idleMs)) return false;
      leaveQueue(thread.id);
      notifyWaiters();
      return true;
    },

    acquire: (thread, options) => {
      if (holder?.thread.id === thread.id) return Promise.resolve({ kind: "granted" });
      const waiter = enqueue(thread);
      waiter.reservedUntil = null;
      return new Promise<AcquireResult>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const listener = options.onWait;
        const finish = (result: AcquireResult) => {
          waiter.calls.delete(wake);
          if (listener) waiter.listeners.delete(listener);
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const wake = () => finish({ kind: "granted" });
        const onAbort = () => {
          finish({ kind: "aborted" });
          if (waiter.calls.size === 0 && queue.includes(waiter)) {
            leaveQueue(thread.id);
            notifyWaiters();
          }
        };
        waiter.calls.add(wake);
        if (listener) waiter.listeners.add(listener);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          waiter.reservedUntil = now() + reservationMs;
          const wait = waitOf(thread.id) ?? { position: 1, holder: holderView() };
          finish({ kind: "still-waiting", wait });
        }, options.maxWaitMs);
        pump();
        if (waiter.calls.has(wake)) listener?.(waitOf(thread.id) ?? { position: 1, holder: null });
      });
    },

    callStarted: (threadId) => {
      if (holder?.thread.id !== threadId) return;
      holder.inFlight += 1;
      holder.lastCallAt = now();
      holder.idleLimit = idleMs;
    },

    callEnded: (threadId) => {
      if (holder?.thread.id !== threadId) return;
      holder.inFlight = Math.max(0, holder.inFlight - 1);
      holder.lastCallAt = now();
    },

    release,

    runEnded: async (threadId) => {
      const index = queue.findIndex((waiter) => waiter.thread.id === threadId);
      if (index >= 0) {
        queue.splice(index, 1);
        notifyWaiters();
      }
      await release(threadId, "run-ended");
    },

    state: () => ({
      holder: holderView(),
      queue: queue.map((waiter, index) => ({
        threadId: waiter.thread.id,
        projectId: waiter.thread.projectId,
        title: waiter.thread.title,
        since: iso(waiter.since),
        position: index + 1,
      })),
      idleReleaseMs: idleMs,
    }),

    waitOf,
    holderId: () => holder?.thread.id ?? null,
    setCleanup: (next) => {
      cleanup = next;
    },
    stop: () => {
      stopTicking();
      if (holder?.tookLock) lock?.release();
    },
  };
};

type LockClaim =
  | { kind: "free" | "took" }
  | { kind: "held"; owner: string | null; heartbeatAt: number }
  | { kind: "lost" };

/**
 * What the old lock directory says about `thread` taking the screen: nobody uses it (`free`), the
 * host took it now or before (`took`), someone else holds it (`held`), or someone took it between
 * the look and the `mkdir` (`lost`). A lock that names the thread is its own, so it is `free` to it;
 * a stale one is removed first.
 */
const claimExternalLock = (lock: ExternalLock | null, thread: CuaThread): LockClaim => {
  if (!lock) return { kind: "free" };
  const found = lock.inspect();
  if (found.kind === "ours") return { kind: "took" };
  if (found.kind === "held") {
    return lockNamesThread(found.owner, thread.title)
      ? { kind: "free" }
      : { kind: "held", owner: found.owner, heartbeatAt: found.heartbeatAt };
  }
  if (found.kind === "stale") {
    logger.warn("Removing a stale computer-use lock {path} (owner {owner})", {
      path: lock.path,
      owner: found.owner ?? "unknown",
    });
    lock.clearStale();
  }
  return lock.take(`AOP host lease: ${thread.title}`) ? { kind: "took" } : { kind: "lost" };
};

const iso = (ms: number): string => new Date(ms).toISOString();

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), ms);
      timer.unref?.();
    }),
  ]);

const defaultEvery = (ms: number, run: () => void): (() => void) => {
  const timer = setInterval(run, ms);
  timer.unref?.();
  return () => clearInterval(timer);
};
