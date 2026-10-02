/**
 * The AOP Browser's tabs, as kept per project: each tab's address and title, which one is in
 * front, and the pages visited lately (the start page lists them). What only a live page knows
 * (loading, its history, its icon) is not here; see BrowserPane.
 */
export interface BrowserTab {
  id: string;
  /** null: the start page, nothing loaded yet. */
  url: string | null;
  title: string;
}

export interface RecentPage {
  url: string;
  title: string;
}

export interface BrowserTabsState {
  tabs: BrowserTab[];
  activeId: string;
  recent: RecentPage[];
}

export type BrowserTabsAction =
  | { type: "open"; url: string | null; afterId?: string }
  | { type: "close"; id: string }
  | { type: "activate"; id: string }
  | { type: "activate-step"; step: 1 | -1 }
  | { type: "navigated"; id: string; url: string }
  | { type: "titled"; id: string; title: string };

const MAX_TABS = 20;
const MAX_RECENT = 12;

let tabCounter = 0;
export const newTabId = (): string => {
  tabCounter += 1;
  return `tab-${Date.now().toString(36)}-${tabCounter}`;
};

export const emptyTabs = (): BrowserTabsState => {
  const tab = { id: newTabId(), url: null, title: "" };
  return { tabs: [tab], activeId: tab.id, recent: [] };
};

export const browserTabsReducer = (
  state: BrowserTabsState,
  action: BrowserTabsAction,
): BrowserTabsState => {
  switch (action.type) {
    case "open":
      return openTab(state, action.url, action.afterId);
    case "close":
      return closeTab(state, action.id);
    case "activate":
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "activate-step":
      return stepTab(state, action.step);
    case "navigated":
      return navigated(state, action.id, action.url);
    case "titled":
      return titled(state, action.id, action.title);
  }
};

/** The tab in front. A state always has one: closing the last tab leaves a start page. */
export const activeTab = (state: BrowserTabsState): BrowserTab =>
  state.tabs.find((tab) => tab.id === state.activeId) ?? (state.tabs[0] as BrowserTab);

const openTab = (
  state: BrowserTabsState,
  url: string | null,
  afterId?: string,
): BrowserTabsState => {
  // The start page in front takes the address instead of a second tab beside it.
  const front = activeTab(state);
  if (url !== null && front.url === null && afterId === undefined) {
    return navigated(state, front.id, url);
  }
  if (state.tabs.length >= MAX_TABS) return state;
  const tab: BrowserTab = { id: newTabId(), url, title: "" };
  const after = state.tabs.findIndex((candidate) => candidate.id === (afterId ?? state.activeId));
  const tabs = [...state.tabs];
  tabs.splice(after < 0 ? tabs.length : after + 1, 0, tab);
  return { ...state, tabs, activeId: tab.id };
};

const closeTab = (state: BrowserTabsState, id: string): BrowserTabsState => {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0) {
    const fresh = { id: newTabId(), url: null, title: "" };
    return { ...state, tabs: [fresh], activeId: fresh.id };
  }
  if (state.activeId !== id) return { ...state, tabs };
  // As in Chrome: the tab to the right comes forward, or the one to the left at the end.
  const next = tabs[Math.min(index, tabs.length - 1)] as BrowserTab;
  return { ...state, tabs, activeId: next.id };
};

const stepTab = (state: BrowserTabsState, step: 1 | -1): BrowserTabsState => {
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
  const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length];
  return next ? { ...state, activeId: next.id } : state;
};

const navigated = (state: BrowserTabsState, id: string, url: string): BrowserTabsState => {
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab || tab.url === url) return state;
  return {
    ...state,
    tabs: state.tabs.map((candidate) =>
      // The old title stays until the new page names itself (a same-page jump never does).
      candidate.id === id ? { ...candidate, url } : candidate,
    ),
    recent: rememberPage(state.recent, { url, title: "" }),
  };
};

const titled = (state: BrowserTabsState, id: string, title: string): BrowserTabsState => {
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab || tab.title === title) return state;
  return {
    ...state,
    tabs: state.tabs.map((candidate) =>
      candidate.id === id ? { ...candidate, title } : candidate,
    ),
    recent: tab.url
      ? state.recent.map((page) => (page.url === tab.url ? { ...page, title } : page))
      : state.recent,
  };
};

// A page visited again keeps the title it had until it names itself anew.
const rememberPage = (recent: RecentPage[], page: RecentPage): RecentPage[] => {
  if (page.url === "about:blank") return recent;
  const known = recent.find((entry) => entry.url === page.url);
  const remembered = { ...page, title: page.title || known?.title || "" };
  return [remembered, ...recent.filter((entry) => entry.url !== page.url)].slice(0, MAX_RECENT);
};

/**
 * Reads a project's saved tabs. Anything malformed (an old shape, a hand edit) is dropped rather
 * than trusted: the browser then starts on one start page.
 */
export const parseSavedTabs = (value: unknown): BrowserTabsState | null => {
  if (typeof value !== "object" || value === null) return null;
  const { tabs, activeId, recent } = value as Record<string, unknown>;
  if (!Array.isArray(tabs)) return null;
  const parsedTabs = tabs.flatMap((tab): BrowserTab[] => {
    const { id, url, title } = (tab ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !id) return [];
    const safeUrl = typeof url === "string" && isWebUrl(url) ? url : null;
    return [{ id, url: safeUrl, title: typeof title === "string" ? title : "" }];
  });
  const first = parsedTabs[0];
  if (!first) return null;
  const active = parsedTabs.some((tab) => tab.id === activeId) ? (activeId as string) : first.id;
  return {
    tabs: parsedTabs.slice(0, MAX_TABS),
    activeId: active,
    recent: Array.isArray(recent) ? parseRecent(recent) : [],
  };
};

const parseRecent = (recent: unknown[]): RecentPage[] =>
  recent
    .flatMap((page): RecentPage[] => {
      const { url, title } = (page ?? {}) as Record<string, unknown>;
      return typeof url === "string" && isWebUrl(url)
        ? [{ url, title: typeof title === "string" ? title : "" }]
        : [];
    })
    .slice(0, MAX_RECENT);

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);
