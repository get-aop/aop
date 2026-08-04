import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "aop.session-merged-pr-dismissed.";

// In-memory mirror of localStorage so useSyncExternalStore gets stable snapshots.
const cache = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * Dismissal is scoped to one PR number: merging a different PR for the same
 * session later must surface the bar again.
 */
export const isMergedPrBarDismissed = (
  sessionId: string | null,
  prNumber: number | null,
): boolean => {
  if (!sessionId || prNumber === null) return false;
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached === prNumber;
  const loaded = readFromStorage(sessionId);
  if (loaded !== null) cache.set(sessionId, loaded);
  return loaded === prNumber;
};

export const dismissMergedPrBar = (sessionId: string, prNumber: number): void => {
  cache.set(sessionId, prNumber);
  try {
    globalThis.localStorage?.setItem(storageKey(sessionId), String(prNumber));
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory value still works.
  }
  for (const listener of listeners) listener();
};

export const subscribeMergedPrBarDismissal = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useMergedPrBarDismissed = (
  sessionId: string | null,
  prNumber: number | null,
): boolean =>
  useSyncExternalStore(
    subscribeMergedPrBarDismissal,
    () => isMergedPrBarDismissed(sessionId, prNumber),
    () => false,
  );

/** Drops the in-memory mirror so tests can simulate a fresh page load. */
export const resetMergedPrBarDismissalForTests = (): void => {
  cache.clear();
};

const readFromStorage = (sessionId: string): number | null => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const storageKey = (sessionId: string): string => `${STORAGE_PREFIX}${sessionId}`;
