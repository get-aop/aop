import type { ConnectionState } from "../../src/backend/types";
import type { HostClient } from "./host-client";
import { probeHost } from "./probe";

export interface WatchedHost {
  host: string;
  /** Null for the host on this Mac, which knows its owner without one. */
  token: string | null;
}

export interface ConnectionMonitor {
  /** Starts looking at a host, or stops looking when given null. Resolves with the first look's result. */
  watch: (target: WatchedHost | null) => Promise<ConnectionState>;
  /** Looks now, without waiting for the next scheduled look. */
  check: () => Promise<ConnectionState>;
  state: () => ConnectionState;
  subscribe: (listener: (state: ConnectionState) => void) => () => void;
}

export interface MonitorDeps {
  clientFor: (hostUrl: string) => HostClient;
  /** Runs `run` after `delayMs` and returns what cancels it. */
  schedule: (run: () => void, delayMs: number) => () => void;
  connectedIntervalMs?: number;
  retryIntervalMs?: number;
}

const CONNECTED_INTERVAL_MS = 15_000;
// A host that is away should be noticed coming back quickly.
const RETRY_INTERVAL_MS = 4_000;

export const createConnectionMonitor = (deps: MonitorDeps): ConnectionMonitor => {
  let target: WatchedHost | null = null;
  let current: ConnectionState = { status: "unconfigured" };
  let generation = 0;
  let cancelNext: (() => void) | null = null;
  const listeners = new Set<(state: ConnectionState) => void>();

  const set = (next: ConnectionState): void => {
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    for (const listener of listeners) listener(next);
  };

  const check = async (): Promise<ConnectionState> => {
    const watched = target;
    if (!watched) return current;
    const mine = generation;
    const result = await probeHost(deps.clientFor(watched.host), watched.host, watched.token);
    // The person may have switched host while this look was in flight; its answer is then stale.
    if (mine !== generation) return current;
    set(result);
    scheduleNext(mine);
    return result;
  };

  const scheduleNext = (mine: number): void => {
    cancelNext?.();
    const delay =
      current.status === "connected"
        ? (deps.connectedIntervalMs ?? CONNECTED_INTERVAL_MS)
        : (deps.retryIntervalMs ?? RETRY_INTERVAL_MS);
    cancelNext = deps.schedule(() => {
      if (mine === generation) void check();
    }, delay);
  };

  return {
    watch: (next) => {
      generation += 1;
      cancelNext?.();
      cancelNext = null;
      target = next;
      if (!next) {
        set({ status: "unconfigured" });
        return Promise.resolve(current);
      }
      set({ status: "connecting", host: next.host });
      return check();
    },
    check,
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
