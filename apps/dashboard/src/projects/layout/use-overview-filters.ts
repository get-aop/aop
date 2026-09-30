import type { ThreadStatus } from "@aop/common";
import { useCallback, useMemo, useState } from "react";

/** What narrows the overview: a search text and the statuses the person has switched off. */
export interface OverviewFilters {
  searchOpen: boolean;
  query: string;
  hidden: ReadonlySet<ThreadStatus>;
  /** Whether anything narrows the list now. */
  active: boolean;
  setQuery: (query: string) => void;
  /** Opens or closes the search box; closing it forgets the text. */
  toggleSearch: () => void;
  toggleStatus: (status: ThreadStatus) => void;
  clear: () => void;
}

export const useOverviewFilters = (): OverviewFilters => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<ThreadStatus>>(new Set());

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    setQuery("");
  }, []);
  const toggleStatus = useCallback((status: ThreadStatus) => {
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setQuery("");
    setHidden(new Set());
  }, []);

  return useMemo(
    () => ({
      searchOpen,
      query,
      hidden,
      active: query.trim() !== "" || hidden.size > 0,
      setQuery,
      toggleSearch,
      toggleStatus,
      clear,
    }),
    [searchOpen, query, hidden, toggleSearch, toggleStatus, clear],
  );
};
