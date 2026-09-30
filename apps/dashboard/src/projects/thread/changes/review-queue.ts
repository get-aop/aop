import { useSyncExternalStore } from "react";

export interface ThreadReviewComment {
  id: string;
  path: string;
  lineType: "context" | "add" | "del";
  oldNo: number | null;
  newNo: number | null;
  excerpt: string;
  note: string;
  createdAt: number;
}

export type NewThreadReviewComment = Omit<ThreadReviewComment, "id" | "createdAt">;

const STORAGE_PREFIX = "aop.thread-review-queue.";
const EMPTY: ThreadReviewComment[] = [];

// In-memory mirror of localStorage so useSyncExternalStore gets stable snapshots.
const cache = new Map<string, ThreadReviewComment[]>();
const listeners = new Set<() => void>();

export const getThreadReviewQueue = (threadId: string | null): ThreadReviewComment[] => {
  if (!threadId) return EMPTY;
  const cached = cache.get(threadId);
  if (cached) return cached;
  const loaded = readFromStorage(threadId);
  cache.set(threadId, loaded);
  return loaded;
};

export const addThreadReviewComment = (
  threadId: string,
  comment: NewThreadReviewComment,
): ThreadReviewComment => {
  const next: ThreadReviewComment = { ...comment, id: newCommentId(), createdAt: Date.now() };
  write(threadId, [...getThreadReviewQueue(threadId), next]);
  return next;
};

export const updateThreadReviewComment = (threadId: string, id: string, note: string): void => {
  write(
    threadId,
    getThreadReviewQueue(threadId).map((comment) =>
      comment.id === id ? { ...comment, note } : comment,
    ),
  );
};

export const removeThreadReviewComment = (threadId: string, id: string): void => {
  write(
    threadId,
    getThreadReviewQueue(threadId).filter((comment) => comment.id !== id),
  );
};

export const clearThreadReviewQueue = (threadId: string): void => {
  write(threadId, EMPTY);
};

export const subscribeThreadReviewQueue = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useThreadReviewQueue = (threadId: string | null): ThreadReviewComment[] =>
  useSyncExternalStore(
    subscribeThreadReviewQueue,
    () => getThreadReviewQueue(threadId),
    getServerReviewQueueSnapshot,
  );

/** Drops the in-memory mirror so tests can simulate a fresh page load. */
export const resetThreadReviewQueueCacheForTests = (): void => {
  cache.clear();
};

const write = (threadId: string, next: ThreadReviewComment[]): void => {
  cache.set(threadId, next.length === 0 ? EMPTY : next);
  try {
    if (next.length === 0) globalThis.localStorage?.removeItem(storageKey(threadId));
    else globalThis.localStorage?.setItem(storageKey(threadId), JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory queue still works.
  }
  for (const listener of listeners) listener();
};

const readFromStorage = (threadId: string): ThreadReviewComment[] => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(threadId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const valid = parsed.filter(isReviewComment);
    return valid.length === 0 ? EMPTY : valid;
  } catch {
    return EMPTY;
  }
};

const isReviewComment = (value: unknown): value is ThreadReviewComment => {
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

const storageKey = (threadId: string): string => `${STORAGE_PREFIX}${threadId}`;

const getServerReviewQueueSnapshot = (): ThreadReviewComment[] => EMPTY;

let fallbackCounter = 0;
const newCommentId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `review-${++fallbackCounter}`;
