/**
 * Where the person is in the app's own history, so the top bar's back and forward can stop at
 * its ends instead of leaving the app (back from the first page goes to `about:blank`) or doing
 * nothing (forward from the newest). Each entry the app pushes carries its position in the
 * browser's entry state; the newest position reached lives in session storage, since a reload
 * keeps the entries but not the page's memory. An entry the app did not stamp is a fresh start:
 * the first entry, with nothing ahead of it.
 */

const STATE_KEY = "aopHistoryIndex";
const FURTHEST_KEY = "aop:history-furthest";

let furthestFallback = 0;

export const canGoBack = (): boolean => position() > 0;

export const canGoForward = (): boolean => stamped() && position() < furthest();

/** Adds an entry after the current one, which ends everything that was ahead of it. */
export const pushEntry = (path: string): void => {
  stampCurrent();
  const next = position() + 1;
  window.history.pushState({ [STATE_KEY]: next }, "", path);
  rememberFurthest(next);
};

/** Swaps the current entry for another at the same position. */
export const replaceEntry = (path: string): void => {
  window.history.replaceState({ [STATE_KEY]: position() }, "", path);
};

const position = (): number => {
  const index = entryState()?.[STATE_KEY];
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0;
};

const entryState = (): Record<string, unknown> | null => {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : null;
};

const stamped = (): boolean => entryState()?.[STATE_KEY] !== undefined;

// The entry the app started on has no stamp yet; without one, coming back to it could not tell
// that entries lie ahead.
const stampCurrent = (): void => {
  if (!stamped()) window.history.replaceState({ [STATE_KEY]: 0 }, "");
};

const furthest = (): number => {
  try {
    const stored = Number(window.sessionStorage.getItem(FURTHEST_KEY));
    return Number.isInteger(stored) ? Math.max(stored, position()) : position();
  } catch {
    return Math.max(furthestFallback, position());
  }
};

const rememberFurthest = (value: number): void => {
  furthestFallback = value;
  try {
    window.sessionStorage.setItem(FURTHEST_KEY, String(value));
  } catch {
    // Storage is blocked: the module's own memory keeps forward right until a reload.
  }
};
