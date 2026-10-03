import type { InboxSummary } from "@aop/common";
import { useEffect, useSyncExternalStore } from "react";
import { getInboxSummary } from "../api/inbox";

/**
 * The Inbox's unread count and whether a source is connected, for the top bar's button. One
 * poller however many bars are on screen, every 15 seconds while the page is visible, and at once
 * after anything the person does in the Inbox. A poll, not a stream: the browser allows six
 * connections per host and the project streams already use four (projects/watch-set.ts).
 */
const POLL_MS = 15_000;

let summary: InboxSummary | null = null;
let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export const useInboxSummary = (): InboxSummary | null => {
  useEffect(startWatching, []);
  return useSyncExternalStore(subscribe, () => summary);
};

/** Reads the count now; silent on failure, the button keeps what it showed. */
export const refreshInboxSummary = async (): Promise<void> => {
  try {
    const next = await getInboxSummary();
    if (
      summary?.unread === next.unread &&
      summary.connected === next.connected &&
      summary.health === next.health
    ) {
      return;
    }
    summary = next;
    for (const listener of listeners) listener();
  } catch {
    // The host is out of reach; the shell's own notice says so.
  }
};

/** Hears every change of the count, for a list that should read itself again. */
export const onInboxSummaryChange = (listener: () => void): (() => void) => subscribe(listener);

/** Test seam. */
export const resetInboxSummaryForTests = (): void => {
  stop();
  summary = null;
  watchers = 0;
  for (const listener of listeners) listener();
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
    stop();
  };
};

const tick = async (): Promise<void> => {
  stop();
  if (document.visibilityState !== "hidden") await refreshInboxSummary();
  if (watchers > 0) timer = setTimeout(tick, POLL_MS);
};

const onVisible = () => {
  if (document.visibilityState === "visible") void tick();
};

const stop = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
