import { useEffect, useState, useSyncExternalStore } from "react";

/** The current time, refreshed on an interval, so an age such as "5m" keeps counting while nothing else changes. */
export const useNow = (intervalMs = 30_000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

/**
 * The same as `useNow()`, but every caller shares one 30-second timer: for something drawn once
 * per message, such as the "2m ago" under each one, where a timer apiece would add up.
 */
export const useSharedNow = (): number => useSyncExternalStore(subscribe, snapshot);

const SHARED_TICK_MS = 30_000;

const listeners = new Set<() => void>();
let sharedNow = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

const tick = () => {
  sharedNow = Date.now();
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (!timer) timer = setInterval(tick, SHARED_TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

// The clock stands still while nobody watches, so the first to look again reads the time anew,
// to the second so that two reads in one render agree.
const snapshot = (): number => {
  if (!timer) sharedNow = Math.floor(Date.now() / 1000) * 1000;
  return sharedNow;
};
