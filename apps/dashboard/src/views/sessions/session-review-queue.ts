import { useSyncExternalStore } from "react";

export interface SessionReviewComment {
  id: string;
  path: string;
  lineType: "context" | "add" | "del";
  oldNo: number | null;
  newNo: number | null;
  excerpt: string;
  note: string;
  createdAt: number;
}

export type NewSessionReviewComment = Omit<SessionReviewComment, "id" | "createdAt">;

const STORAGE_PREFIX = "aop.session-review-queue.";
const EMPTY: SessionReviewComment[] = [];

// In-memory mirror of localStorage so useSyncExternalStore gets stable snapshots.
const cache = new Map<string, SessionReviewComment[]>();
const listeners = new Set<() => void>();

export const getSessionReviewQueue = (sessionId: string | null): SessionReviewComment[] => {
  if (!sessionId) return EMPTY;
  const cached = cache.get(sessionId);
  if (cached) return cached;
  const loaded = readFromStorage(sessionId);
  cache.set(sessionId, loaded);
  return loaded;
};

export const addSessionReviewComment = (
  sessionId: string,
  comment: NewSessionReviewComment,
): SessionReviewComment => {
  const next: SessionReviewComment = { ...comment, id: newCommentId(), createdAt: Date.now() };
  write(sessionId, [...getSessionReviewQueue(sessionId), next]);
  return next;
};

export const updateSessionReviewComment = (sessionId: string, id: string, note: string): void => {
  write(
    sessionId,
    getSessionReviewQueue(sessionId).map((comment) =>
      comment.id === id ? { ...comment, note } : comment,
    ),
  );
};

export const removeSessionReviewComment = (sessionId: string, id: string): void => {
  write(
    sessionId,
    getSessionReviewQueue(sessionId).filter((comment) => comment.id !== id),
  );
};

export const clearSessionReviewQueue = (sessionId: string): void => {
  write(sessionId, EMPTY);
};

/** Restores a failed send only when the queue is still empty (mirrors draft restore). */
export const restoreSessionReviewQueueIfEmpty = (
  sessionId: string,
  comments: SessionReviewComment[],
): void => {
  if (comments.length === 0 || getSessionReviewQueue(sessionId).length > 0) return;
  write(sessionId, comments);
};

export const subscribeSessionReviewQueue = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSessionReviewQueue = (sessionId: string | null): SessionReviewComment[] =>
  useSyncExternalStore(
    subscribeSessionReviewQueue,
    () => getSessionReviewQueue(sessionId),
    getServerReviewQueueSnapshot,
  );

/** Drops the in-memory mirror so tests can simulate a fresh page load. */
export const resetSessionReviewQueueCacheForTests = (): void => {
  cache.clear();
};

const write = (sessionId: string, next: SessionReviewComment[]): void => {
  cache.set(sessionId, next.length === 0 ? EMPTY : next);
  try {
    if (next.length === 0) globalThis.localStorage?.removeItem(storageKey(sessionId));
    else globalThis.localStorage?.setItem(storageKey(sessionId), JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory queue still works.
  }
  for (const listener of listeners) listener();
};

const readFromStorage = (sessionId: string): SessionReviewComment[] => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(sessionId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const valid = parsed.filter(isReviewComment);
    return valid.length === 0 ? EMPTY : valid;
  } catch {
    return EMPTY;
  }
};

const isReviewComment = (value: unknown): value is SessionReviewComment => {
  if (typeof value !== "object" || value === null) return false;
  const comment = value as Record<string, unknown>;
  return (
    typeof comment.id === "string" &&
    typeof comment.path === "string" &&
    typeof comment.note === "string" &&
    typeof comment.excerpt === "string" &&
    (comment.lineType === "context" || comment.lineType === "add" || comment.lineType === "del")
  );
};

const storageKey = (sessionId: string): string => `${STORAGE_PREFIX}${sessionId}`;

const getServerReviewQueueSnapshot = (): SessionReviewComment[] => EMPTY;

let fallbackCounter = 0;
const newCommentId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `review-${++fallbackCounter}`;
