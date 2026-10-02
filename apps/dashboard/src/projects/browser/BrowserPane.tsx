import type {
  BrowserDownload,
  BrowserHostEvent,
  BrowserPrompt,
  BrowserShortcut,
  DesktopBrowserBridge,
} from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserHeader, type TabBadge } from "./BrowserHeader";
import { DownloadsButton, PageErrorView, PromptBar, StartPage } from "./BrowserNotices";
import { type AddressBarHandle, BrowserToolbar, type ToolbarState } from "./BrowserToolbar";
import { BrowserWebview, type PageError, type PageReport, type TabPage } from "./BrowserWebview";
import { closeBrowserView, subscribeQueuedUrls, takeQueuedUrls } from "./open-browser-view";
import { activeTab, type BrowserTab, type BrowserTabsAction } from "./tabs";
import { useBrowserTabs } from "./use-browser-tabs";

/** What a live page knows that the saved tabs do not. */
interface TabRuntime {
  webContentsId?: number;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  error?: PageError | null;
  /** Home was pressed: the start page covers the page, which Back brings back. */
  home?: boolean;
}

const IDLE: TabRuntime = { loading: false, canGoBack: false, canGoForward: false };

/**
 * The AOP Browser in the coordinator chat's place: the breadcrumb and tabs, the toolbar, a page's
 * question, and the pages themselves. Each tab's page is a `<webview>` that stays alive behind
 * the others; the pane itself stays mounted while the chat is shown (see BrowserColumn), so
 * coming back finds every page as it was.
 */
export const BrowserPane = ({
  projectId,
  shown,
  bridge,
}: {
  projectId: string;
  shown: boolean;
  bridge: DesktopBrowserBridge;
}) => {
  const [tabs, dispatch] = useBrowserTabs(projectId);
  const [runtime, setRuntime] = useState<Record<string, TabRuntime>>({});
  const [prompts, setPrompts] = useState<BrowserPrompt[]>([]);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const pages = useRef(new Map<string, TabPage>());
  const addressRef = useRef<AddressBarHandle>(null);

  const front = activeTab(tabs);
  const loaded = useTabsLoaded(front.id);
  const frontRuntime = runtime[front.id] ?? IDLE;
  const onStartPage = front.url === null || Boolean(frontRuntime.home);
  const frontPrompt = prompts.find((prompt) => prompt.webContentsId === frontRuntime.webContentsId);
  const frontError = onStartPage ? null : (frontRuntime.error ?? null);

  const report = useCallback((tabId: string, patch: Partial<TabRuntime>) => {
    setRuntime((current) => ({ ...current, [tabId]: { ...IDLE, ...current[tabId], ...patch } }));
  }, []);

  const navigateFront = (url: string) => {
    report(front.id, { home: false, error: null });
    if (front.url === null) dispatch({ type: "navigated", id: front.id, url });
    else pages.current.get(front.id)?.load(url);
  };

  const runShortcut = (shortcut: BrowserShortcut, tabId: string) => {
    const page = pages.current.get(tabId);
    const tabRuntime = runtime[tabId] ?? IDLE;
    const action = shortcutAction(shortcut, {
      page,
      home: Boolean(tabRuntime.home),
      leaveHome: () => report(tabId, { home: false }),
      dispatch,
      tabId,
      focusAddress: () => addressRef.current?.focus(),
    });
    action();
  };

  useActiveInApp(bridge, shown);
  useQueuedUrls(projectId, dispatch);
  useHostEvents(bridge, {
    tabFor: (webContentsId) =>
      webContentsId === null ? front.id : tabWithPage(runtime, webContentsId),
    runShortcut,
    openTab: (url, afterId) => dispatch({ type: "open", url, afterId }),
    favicon: (tabId, favicon) => report(tabId, { favicon }),
    setPrompts,
    setDownloads,
  });
  useFocusFront(shown, front.id, onStartPage, () =>
    onStartPage ? addressRef.current?.focus() : pages.current.get(front.id)?.focus(),
  );

  return (
    <div data-testid="browser-pane" className="flex min-h-0 flex-1 flex-col">
      <BrowserHeader
        tabs={tabs.tabs}
        activeId={tabs.activeId}
        badges={tabBadges(tabs.tabs, runtime, prompts)}
        onActivate={(id) => dispatch({ type: "activate", id })}
        onClose={(id) => dispatch({ type: "close", id })}
        onNewTab={() => dispatch({ type: "open", url: null })}
      />
      <BrowserToolbar
        addressRef={addressRef}
        state={toolbarState(front.url, frontRuntime, onStartPage)}
        onNavigate={navigateFront}
        onBack={() => runShortcut("back", front.id)}
        onForward={() => runShortcut("forward", front.id)}
        onReload={() => runShortcut("reload", front.id)}
        onStop={() => pages.current.get(front.id)?.stop()}
        onHome={() => report(front.id, { home: true })}
        onDevtools={() => runShortcut("devtools", front.id)}
        onEscape={() => {
          if (!onStartPage) pages.current.get(front.id)?.focus();
        }}
      >
        <DownloadsButton
          downloads={downloads}
          onAction={(id, action) => void bridge.downloadAction(id, action).catch(() => undefined)}
        />
      </BrowserToolbar>
      {frontPrompt ? (
        <PromptBar
          prompt={frontPrompt}
          onAnswer={(id, allow) => void bridge.answerPrompt(id, allow).catch(() => undefined)}
        />
      ) : null}
      <div data-testid="browser-viewport" className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.tabs.map((tab) =>
          tab.url === null || !loaded.has(tab.id) ? null : (
            <TabWebview
              key={tab.id}
              tabId={tab.id}
              initialUrl={tab.url}
              front={tab.id === front.id}
              pages={pages.current}
              report={report}
              dispatch={dispatch}
            />
          ),
        )}
        {onStartPage ? <StartPage recent={tabs.recent} onOpen={navigateFront} /> : null}
        {frontError ? (
          <PageErrorView error={frontError} onRetry={() => navigateFront(frontError.url)} />
        ) : null}
      </div>
    </div>
  );
};

const tabWithPage = (runtime: Record<string, TabRuntime>, webContentsId: number): string | null =>
  Object.entries(runtime).find(([, tab]) => tab.webContentsId === webContentsId)?.[0] ?? null;

const tabBadges = (
  tabs: readonly BrowserTab[],
  runtime: Record<string, TabRuntime>,
  prompts: readonly BrowserPrompt[],
): Record<string, TabBadge> =>
  Object.fromEntries(
    tabs.map((tab) => {
      const state = runtime[tab.id] ?? IDLE;
      const asking = prompts.some((prompt) => prompt.webContentsId === state.webContentsId);
      return [tab.id, { favicon: state.favicon, loading: state.loading, asking }];
    }),
  );

const toolbarState = (
  url: string | null,
  runtime: TabRuntime,
  onStartPage: boolean,
): ToolbarState => ({
  url,
  loading: !onStartPage && runtime.loading,
  // Back from Home returns to the page under it.
  canGoBack: Boolean(runtime.home) || runtime.canGoBack,
  canGoForward: !onStartPage && runtime.canGoForward,
  onStartPage,
});

/** One tab's page, with callbacks that stay the same for its whole life. */
const TabWebview = ({
  tabId,
  initialUrl,
  front,
  pages,
  report,
  dispatch,
}: {
  tabId: string;
  initialUrl: string;
  front: boolean;
  pages: Map<string, TabPage>;
  report: (tabId: string, patch: PageReport) => void;
  dispatch: (action: BrowserTabsAction) => void;
}) => {
  const register = useCallback(
    (page: TabPage | null) => {
      if (page) pages.set(tabId, page);
      else pages.delete(tabId);
    },
    [pages, tabId],
  );
  return (
    <BrowserWebview
      initialUrl={initialUrl}
      front={front}
      register={register}
      onReport={(patch) => report(tabId, patch)}
      onNavigated={(url) => dispatch({ type: "navigated", id: tabId, url })}
      onTitle={(title) => dispatch({ type: "titled", id: tabId, title })}
    />
  );
};

interface ShortcutContext {
  page: TabPage | undefined;
  home: boolean;
  leaveHome: () => void;
  dispatch: (action: BrowserTabsAction) => void;
  tabId: string;
  focusAddress: () => void;
}

const shortcutAction = (shortcut: BrowserShortcut, context: ShortcutContext): (() => void) => {
  const { page, dispatch, tabId } = context;
  const onPage = (run: (page: TabPage) => void) => () => {
    if (page && !context.home) run(page);
  };
  const actions: Record<BrowserShortcut, () => void> = {
    "toggle-browser": closeBrowserView,
    "focus-address": context.focusAddress,
    reload: onPage((target) => target.reload()),
    "hard-reload": onPage((target) => target.reload(true)),
    back: context.home ? context.leaveHome : onPage((target) => target.back()),
    forward: onPage((target) => target.forward()),
    devtools: onPage((target) => target.toggleDevtools()),
    "new-tab": () => dispatch({ type: "open", url: null }),
    "close-tab": () => dispatch({ type: "close", id: tabId }),
    "next-tab": () => dispatch({ type: "activate-step", step: 1 }),
    "previous-tab": () => dispatch({ type: "activate-step", step: -1 }),
    // A page's zoom is the app's to do; nothing reaches here.
    "zoom-in": () => {},
    "zoom-out": () => {},
    "zoom-reset": () => {},
  };
  return actions[shortcut];
};

/**
 * The tabs whose pages have been in front since the browser opened. Saved tabs come back as
 * names only and load when first brought forward, as Chrome restores a session, so twenty saved
 * tabs do not load twenty pages at once.
 */
const useTabsLoaded = (frontId: string): ReadonlySet<string> => {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set([frontId]));
  useEffect(() => {
    setLoaded((current) => (current.has(frontId) ? current : new Set([...current, frontId])));
  }, [frontId]);
  return loaded.has(frontId) ? loaded : new Set([...loaded, frontId]);
};

/** Tells the app whether the browser is shown, so its window sends ⌘R and the rest here. */
const useActiveInApp = (bridge: DesktopBrowserBridge, shown: boolean): void => {
  useEffect(() => {
    void bridge.setActive(shown).catch(() => undefined);
    return () => void bridge.setActive(false).catch(() => undefined);
  }, [bridge, shown]);
};

/** Addresses sent here before or after the browser opened ("Open in AOP Browser"). */
const useQueuedUrls = (projectId: string, dispatch: (action: BrowserTabsAction) => void): void => {
  useEffect(() => {
    const take = () => {
      for (const url of takeQueuedUrls(projectId)) dispatch({ type: "open", url });
    };
    take();
    return subscribeQueuedUrls(take);
  }, [projectId, dispatch]);
};

interface HostEventHandlers {
  tabFor: (webContentsId: number | null) => string | null;
  runShortcut: (shortcut: BrowserShortcut, tabId: string) => void;
  openTab: (url: string, afterId: string) => void;
  favicon: (tabId: string, favicon: string) => void;
  setPrompts: React.Dispatch<React.SetStateAction<BrowserPrompt[]>>;
  setDownloads: React.Dispatch<React.SetStateAction<BrowserDownload[]>>;
}

/** What the app's main process saw: keys typed in a page, new tabs, icons, questions, downloads. */
const useHostEvents = (bridge: DesktopBrowserBridge, handlers: HostEventHandlers): void => {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => bridge.onEvent((event) => handleHostEvent(event, latest.current)), [bridge]);
};

const handleHostEvent = (event: BrowserHostEvent, on: HostEventHandlers): void => {
  switch (event.kind) {
    case "shortcut":
      onShortcut(event, on);
      return;
    case "open-tab": {
      // The window's own "Open in AOP Browser" goes through openBrowserView instead.
      const opener = event.webContentsId === null ? null : on.tabFor(event.webContentsId);
      if (opener) on.openTab(event.url, opener);
      return;
    }
    case "favicon": {
      const tabId = on.tabFor(event.webContentsId);
      if (tabId) on.favicon(tabId, event.dataUrl);
      return;
    }
    case "prompt":
      on.setPrompts((current) => [...current, event.prompt]);
      return;
    case "prompt-closed":
      on.setPrompts((current) => current.filter((prompt) => prompt.id !== event.id));
      return;
    case "download":
      on.setDownloads((current) => [
        event.download,
        ...current.filter((download) => download.id !== event.download.id),
      ]);
  }
};

const onShortcut = (
  event: Extract<BrowserHostEvent, { kind: "shortcut" }>,
  on: HostEventHandlers,
): void => {
  // From the window itself, a dialog open over the browser keeps its keys.
  if (event.webContentsId === null && document.querySelector('[role="dialog"]')) return;
  const tabId = on.tabFor(event.webContentsId);
  if (tabId) on.runShortcut(event.shortcut, tabId);
};

/** Focus follows what is in front when the browser shows or the tab changes: the page, or the address bar on a start page. */
const useFocusFront = (
  shown: boolean,
  tabId: string,
  onStartPage: boolean,
  focus: () => void,
): void => {
  const latest = useRef(focus);
  latest.current = focus;
  useEffect(() => {
    void tabId;
    void onStartPage;
    if (shown) latest.current();
  }, [shown, tabId, onStartPage]);
};
