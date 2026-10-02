import type { LiveViewSession, LiveViewStatus } from "@aop/common";
import { useEffect, useSyncExternalStore } from "react";
import { getLiveViewStatus } from "../api/live-view";

/**
 * The live view's state on this page: what the host says (who uses CUA, whether this viewer gets
 * the view), and what the person chose (closed, minimized, full screen, which thread). The host
 * is asked every few seconds while the view's container is mounted and the page is visible.
 *
 * Closing lasts for this tab's session (sessionStorage): the top bar's "Live view" button brings
 * it back. Minimized and the popup's corner are remembered across sessions (see placement.ts).
 */
export interface LiveViewState {
  status: LiveViewStatus | null;
  closed: boolean;
  minimized: boolean;
  fullscreen: boolean;
  /** The thread being watched: picked in the switcher, or followed by `followedThread`. */
  pickedThreadId: string | null;
}

export const STATUS_POLL_MS = 3_000;
const CLOSED_KEY = "aop:live-view:closed";
const MINIMIZED_KEY = "aop:live-view:minimized";

// Above the state, which reads the stored choices when the module loads.
const readFlag = (storage: Storage | null, key: string): boolean => storage?.getItem(key) === "1";

const writeFlag = (storage: Storage | null, key: string, value: boolean): void => {
  try {
    if (value) storage?.setItem(key, "1");
    else storage?.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
};

const sessionStorageOrNull = (): Storage | null =>
  typeof window === "undefined" ? null : window.sessionStorage;

const localStorageOrNull = (): Storage | null =>
  typeof window === "undefined" ? null : window.localStorage;

const initial = (): LiveViewState => ({
  status: null,
  closed: readFlag(sessionStorageOrNull(), CLOSED_KEY),
  minimized: readFlag(localStorageOrNull(), MINIMIZED_KEY),
  fullscreen: false,
  pickedThreadId: null,
});

let state: LiveViewState = initial();
let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

/** The live view's state, without asking the host (the top bar's button reads it this way). */
export const useLiveViewState = (): LiveViewState => useSyncExternalStore(subscribe, () => state);

/** The live view's state, kept current from the host while the caller is mounted. */
export const useWatchedLiveView = (): LiveViewState => {
  useEffect(startWatching, []);
  return useLiveViewState();
};

/** The thread the view shows: none unless this viewer gets the view and a thread uses CUA. */
export const shownSession = (current: LiveViewState): LiveViewSession | null => {
  const { status } = current;
  if (!status?.shown) return null;
  return (
    status.sessions.find((session) => session.threadId === current.pickedThreadId) ??
    status.sessions[0] ??
    null
  );
};

export const closeLiveView = (): void => {
  writeFlag(sessionStorageOrNull(), CLOSED_KEY, true);
  publish({ closed: true, fullscreen: false });
};

export const showLiveView = (): void => {
  writeFlag(sessionStorageOrNull(), CLOSED_KEY, false);
  publish({ closed: false, minimized: false });
  writeFlag(localStorageOrNull(), MINIMIZED_KEY, false);
};

export const setLiveViewMinimized = (minimized: boolean): void => {
  writeFlag(localStorageOrNull(), MINIMIZED_KEY, minimized);
  publish({ minimized });
};

export const setLiveViewFullscreen = (fullscreen: boolean): void => publish({ fullscreen });

export const pickLiveViewThread = (threadId: string): void => publish({ pickedThreadId: threadId });

/**
 * Which thread the view follows. A thread that just started using CUA takes the view (the newest,
 * if several did); otherwise the view stays on the thread it shows, so two threads taking turns
 * on the screen do not flip it back and forth; and when that thread's session ends or is gone,
 * the most recently active one takes over (an ending one stays only while nothing else is active).
 */
export const followedThread = (
  before: LiveViewStatus | null,
  after: LiveViewStatus,
  current: string | null,
): string | null => {
  const known = new Set(before?.sessions.map((session) => session.threadId));
  const started = after.sessions
    .filter((session) => !session.ending && !known.has(session.threadId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (before && started[0]) return started[0].threadId;
  const followed = after.sessions.find((session) => session.threadId === current);
  // The host lists active sessions first: one that is ending gives way to a thread still at work.
  const next = after.sessions[0];
  if (followed && !(followed.ending && next && !next.ending)) return current;
  return next?.threadId ?? null;
};

/** Asks the host now. Silent on failure: the view keeps what it had until the next answer. */
export const refreshLiveView = async (): Promise<void> => {
  const asked = generation;
  try {
    const status = await getLiveViewStatus();
    if (asked !== generation) return;
    const pickedThreadId = followedThread(state.status, status, state.pickedThreadId);
    const next = { ...state, status, pickedThreadId };
    // Full screen ends with the last session, so a new one opens as the popup.
    publish(shownSession(next) ? next : { ...next, fullscreen: false });
  } catch {
    // A host out of reach says so in the top bar; the view just waits.
  }
};

/** Test seam: forget everything, storage included. */
export const resetLiveViewForTests = (): void => {
  stopTimer();
  generation += 1;
  watchers = 0;
  sessionStorageOrNull()?.removeItem(CLOSED_KEY);
  localStorageOrNull()?.removeItem(MINIMIZED_KEY);
  state = initial();
  emit();
};

const startWatching = (): (() => void) => {
  watchers += 1;
  if (watchers === 1) {
    document.addEventListener("visibilitychange", onVisible);
    void tick();
  }
  return () => {
    watchers -= 1;
    if (watchers > 0) return;
    document.removeEventListener("visibilitychange", onVisible);
    stopTimer();
  };
};

// A hidden page is not polled; it asks again the moment it comes back.
const tick = async (): Promise<void> => {
  stopTimer();
  if (document.visibilityState === "hidden") return;
  const asked = generation;
  await refreshLiveView();
  if (asked !== generation || watchers === 0) return;
  timer = setTimeout(() => void tick(), STATUS_POLL_MS);
};

const onVisible = (): void => {
  if (document.visibilityState === "visible") void tick();
  else stopTimer();
};

const stopTimer = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
};

const publish = (patch: Partial<LiveViewState>): void => {
  state = { ...state, ...patch };
  emit();
};

const emit = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
