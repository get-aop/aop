import type { InboxItem, InboxView } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { getInboxItem, listInboxItems } from "../api/inbox";
import { messageOf } from "./inbox-format";
import { onInboxSummaryChange, refreshInboxSummary } from "./inbox-summary-store";

/**
 * The Inbox page's list: a view, optionally only the channels mapped to a project, read again
 * whenever the unread count moves (a new message) and after the person acts on an item. The open
 * item comes from the list, or is read on its own when it is not in this view (a link to it).
 */
export interface InboxState {
  view: InboxView;
  setView: (view: InboxView) => void;
  projectId: string | null;
  setProjectId: (projectId: string | null) => void;
  items: InboxItem[] | null;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  selected: InboxItem | null;
  /** An item changed (the person acted on it): show it, and read the list and the count again. */
  changed: (item: InboxItem) => void;
}

export const useInbox = (itemId: string | null): InboxState => {
  const [view, setView] = useState<InboxView>("needs-me");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<InboxItem | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const asked = ++latest.current;
    const page = await listInboxItems(view, { projectId: projectId ?? undefined }).catch(
      (cause: unknown) => messageOf(cause),
    );
    // An answer to an older ask (the person switched views meanwhile) is dropped.
    if (asked !== latest.current) return;
    if (typeof page === "string") {
      setError(page);
      return;
    }
    setItems(page.items);
    setCursor(page.nextCursor);
    setError(null);
  }, [view, projectId]);

  useEffect(() => {
    void load();
    // A new unread count means new messages.
    return onInboxSummaryChange(() => void load());
  }, [load]);

  const fromList = items?.find((item) => item.id === itemId) ?? null;
  useEffect(() => {
    if (!itemId || fromList) return;
    let live = true;
    void getInboxItem(itemId)
      .then((item) => live && setOpened(item))
      .catch(() => live && setOpened(null));
    return () => {
      live = false;
    };
  }, [itemId, fromList]);

  const changed = useCallback(
    (item: InboxItem) => {
      setItems((current) => current?.map((entry) => (entry.id === item.id ? item : entry)) ?? null);
      setOpened(item);
      void load();
      void refreshInboxSummary();
    },
    [load],
  );

  const loadMore = useCallback(() => {
    if (!cursor) return;
    void listInboxItems(view, { cursor, projectId: projectId ?? undefined }).then((page) => {
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    });
  }, [cursor, view, projectId]);

  return {
    view,
    setView,
    projectId,
    setProjectId,
    items,
    error,
    hasMore: cursor !== null,
    loadMore,
    selected: fromList ?? (opened?.id === itemId ? opened : null),
    changed,
  };
};
