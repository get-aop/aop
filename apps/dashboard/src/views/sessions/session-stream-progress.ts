import { useSyncExternalStore } from "react";
import type { AssistantStreamProgress } from "./sessions-page-helpers";

type StreamSnapshot = {
  sessionId: string | null;
  progress: AssistantStreamProgress | null;
};

export type StreamProgressUpdate =
  | AssistantStreamProgress
  | null
  | ((current: AssistantStreamProgress | null) => AssistantStreamProgress | null);

let snapshot: StreamSnapshot = { sessionId: null, progress: null };
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const subscribeSessionStreamProgress = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Writes live assistant stream progress without re-rendering SessionsPage. */
export const setSessionStreamProgress = (
  sessionId: string | null,
  update: StreamProgressUpdate,
): void => {
  const next = typeof update === "function" ? update(snapshot.progress) : update;
  if (!sessionId || next === null) {
    clearProgress(sessionId);
    return;
  }
  if (snapshot.sessionId === sessionId && snapshot.progress === next) return;
  snapshot = { sessionId, progress: next };
  emit();
};

const clearProgress = (sessionId: string | null): void => {
  if (snapshot.progress === null && snapshot.sessionId === null) return;
  // Clear only when the writer matches the active stream (or session is unknown).
  if (sessionId && snapshot.sessionId && snapshot.sessionId !== sessionId) return;
  snapshot = { sessionId: null, progress: null };
  emit();
};

export const clearSessionStreamProgress = (sessionId?: string | null): void => {
  setSessionStreamProgress(sessionId ?? snapshot.sessionId, null);
};

export const getSessionStreamProgressSnapshot = (): StreamSnapshot => snapshot;

/** Subscribes only the live-activity row so transcript/composer stay idle during streaming. */
export const useSessionStreamProgress = (
  sessionId: string | null,
): AssistantStreamProgress | null =>
  useSyncExternalStore(
    subscribeSessionStreamProgress,
    () => {
      if (!sessionId || snapshot.sessionId !== sessionId) return null;
      return snapshot.progress;
    },
    () => null,
  );

/** Test helper — resets module state between cases. */
export const resetSessionStreamProgressStore = (): void => {
  snapshot = { sessionId: null, progress: null };
  listeners.clear();
};
