import { useSyncExternalStore } from "react";

/** What the person did with one suggested thread. A suggestion nobody acted on has no entry. */
export type Resolution = { state: "started"; threadId: string } | { state: "skipped" };

export type Resolutions = Readonly<Record<string, Resolution>>;

const STORAGE_KEY = "aop:suggestion-resolutions:v1";
const NONE: Resolutions = {};

/**
 * Which suggested threads this browser has started or skipped. The host keeps no record of an
 * answer to a proposal (starting one is an ordinary new thread), so it is kept here, per
 * device, keyed by the suggestion's id, and a proposal answered on another computer shows as
 * waiting again on this one.
 */
export interface SuggestionStore {
  getSnapshot: () => Resolutions;
  subscribe: (listener: () => void) => () => void;
  set: (suggestionId: string, resolution: Resolution) => void;
  /** Takes back a skip: the suggestion waits for an answer again. */
  clear: (suggestionId: string) => void;
}

export const createSuggestionStore = (
  storage: Pick<Storage, "getItem" | "setItem">,
): SuggestionStore => {
  let snapshot: Resolutions = read(storage);
  const listeners = new Set<() => void>();

  const replace = (next: Resolutions) => {
    snapshot = next;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the answer holds for this visit and is asked again on the next.
    }
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (suggestionId, resolution) => replace({ ...snapshot, [suggestionId]: resolution }),
    clear: (suggestionId) => {
      const { [suggestionId]: _taken, ...rest } = snapshot;
      replace(rest);
    },
  };
};

let browserStore: SuggestionStore | null = null;

/** The store over this browser's local storage; made on first use, so importing it touches nothing. */
export const browserSuggestionStore = (): SuggestionStore => {
  browserStore ??= createSuggestionStore(window.localStorage);
  return browserStore;
};

export const useSuggestionResolutions = (store: SuggestionStore): Resolutions =>
  useSyncExternalStore(store.subscribe, store.getSnapshot);

const read = (storage: Pick<Storage, "getItem">): Resolutions => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Resolutions)
      : NONE;
  } catch {
    return NONE;
  }
};
