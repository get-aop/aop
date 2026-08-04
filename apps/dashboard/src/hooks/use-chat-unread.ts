import type { ChatUnreadKind } from "@aop/common";
import { useEffect, useSyncExternalStore } from "react";

export interface ChatUnreadItem {
  sessionId: string;
  title: string;
  snippet: string;
  kind: ChatUnreadKind;
  count: number;
}

interface ChatUnreadSnapshot {
  total: number;
  items: ChatUnreadItem[];
}

let activeSessionId: string | null = null;
let activeVisible = false;
let items = new Map<string, ChatUnreadItem>();
let snapshot: ChatUnreadSnapshot = { total: 0, items: [] };
const listeners = new Set<() => void>();
/** Fired when a background session gains an unread assistant message (for session-row badges). */
const sessionIncrementListeners = new Set<(sessionId: string) => void>();

export const useChatUnread = (): ChatUnreadSnapshot =>
  useSyncExternalStore(subscribe, getChatUnreadSnapshot, getChatUnreadSnapshot);

export const useActiveChatUnread = (sessionId: string | null): void => {
  useEffect(() => {
    const sync = () => setActiveChatSession(sessionId, document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      setActiveChatSession(null, false);
    };
  }, [sessionId]);
};

export const getChatUnreadSnapshot = (): ChatUnreadSnapshot => snapshot;

export const setActiveChatSession = (sessionId: string | null, visible: boolean): void => {
  activeSessionId = sessionId;
  activeVisible = visible;
  if (sessionId) clearChatUnread(sessionId);
};

export const receiveChatUnread = (event: Omit<ChatUnreadItem, "count">): void => {
  if (activeVisible && event.sessionId === activeSessionId) return;
  const current = items.get(event.sessionId);
  items = new Map(items).set(event.sessionId, {
    ...event,
    count: (current?.count ?? 0) + 1,
  });
  publish();
  for (const listener of sessionIncrementListeners) listener(event.sessionId);
};

/** Subscribe to per-session unread increments for rail badges (non-active sessions only). */
export const subscribeChatUnreadSessionIncrement = (
  listener: (sessionId: string) => void,
): (() => void) => {
  sessionIncrementListeners.add(listener);
  return () => {
    sessionIncrementListeners.delete(listener);
  };
};

export const clearChatUnread = (sessionId: string): void => {
  if (!items.has(sessionId)) return;
  items = new Map(items);
  items.delete(sessionId);
  publish();
};

export const resetChatUnreadStore = (): void => {
  activeSessionId = null;
  activeVisible = false;
  items = new Map();
  publish();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const publish = (): void => {
  const nextItems = [...items.values()];
  snapshot = {
    total: nextItems.reduce((total, item) => total + item.count, 0),
    items: nextItems,
  };
  for (const listener of listeners) listener();
};
