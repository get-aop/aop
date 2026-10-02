import { AOP_BROWSER_PARTITION } from "@aop/common";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** The Electron `<webview>` methods the browser uses. They throw until the guest is ready. */
interface WebviewElement extends HTMLElement {
  src: string;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  reloadIgnoringCache: () => void;
  stop: () => void;
  openDevTools: () => void;
  isDevToolsOpened: () => boolean;
  closeDevTools: () => void;
  getWebContentsId: () => number;
}

/** What the pane may ask of one tab's page. */
export interface TabPage {
  load: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: (ignoringCache?: boolean) => void;
  stop: () => void;
  toggleDevtools: () => void;
  focus: () => void;
}

/** What a page reports: where it is, what it is called, whether it is loading or failed. */
export interface PageReport {
  webContentsId?: number;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: PageError | null;
}

export interface PageError {
  code: number;
  description: string;
  url: string;
}

// A navigation a newer one replaced; not a failure to show.
const ERR_ABORTED = -3;

/**
 * One tab's page: an Electron `<webview>` guest on the browser's own partition. The app's main
 * process pins it sandboxed with no preload (see apps/desktop/electron/browser). A tab behind
 * another is moved out of the window rather than hidden: Electron 43 can leave a macOS webview
 * blank for good after `visibility: hidden` (found by T3 Code), and off-screen it stops painting.
 */
export const BrowserWebview = ({
  initialUrl,
  front,
  onReport,
  onNavigated,
  onTitle,
  register,
}: {
  initialUrl: string;
  front: boolean;
  onReport: (report: PageReport) => void;
  onNavigated: (url: string) => void;
  onTitle: (title: string) => void;
  register: (page: TabPage | null) => void;
}) => {
  const ref = useRef<WebviewElement | null>(null);
  const [src] = useState(initialUrl);
  const callbacks = useRef({ onReport, onNavigated, onTitle });
  callbacks.current = { onReport, onNavigated, onTitle };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const ready = { current: false };
    register(tabPage(element, ready));
    const detach = listen(element, ready, callbacks);
    return () => {
      detach();
      register(null);
    };
  }, [register]);

  return (
    <webview
      ref={ref as React.Ref<HTMLWebViewElement>}
      data-testid="browser-webview"
      data-front={front}
      src={src}
      partition={AOP_BROWSER_PARTITION}
      // Read when the guest attaches, as an attribute; React drops a boolean on an unknown one.
      // The main process still decides what each new window becomes.
      {...({ allowpopups: "true" } as unknown as { allowpopups?: boolean })}
      aria-hidden={front ? undefined : true}
      className={cn(
        "absolute top-0 flex h-full w-full bg-white",
        front ? "left-0" : "pointer-events-none -left-[200vw]",
      )}
    />
  );
};

const tabPage = (element: WebviewElement, ready: { current: boolean }): TabPage => {
  const whenReady = (run: () => void) => {
    if (!ready.current) return;
    try {
      run();
    } catch {
      // The guest went away between the check and the call; the next event resyncs.
    }
  };
  return {
    load: (url) => {
      if (ready.current) void element.loadURL(url).catch(() => undefined);
      else element.src = url;
    },
    back: () => whenReady(() => element.goBack()),
    forward: () => whenReady(() => element.goForward()),
    reload: (ignoringCache) =>
      whenReady(() => (ignoringCache ? element.reloadIgnoringCache() : element.reload())),
    stop: () => whenReady(() => element.stop()),
    toggleDevtools: () =>
      whenReady(() =>
        element.isDevToolsOpened() ? element.closeDevTools() : element.openDevTools(),
      ),
    focus: () => element.focus(),
  };
};

type Callbacks = {
  current: {
    onReport: (report: PageReport) => void;
    onNavigated: (url: string) => void;
    onTitle: (title: string) => void;
  };
};

const listen = (
  element: WebviewElement,
  ready: { current: boolean },
  callbacks: Callbacks,
): (() => void) => {
  const history = () => ({ canGoBack: element.canGoBack(), canGoForward: element.canGoForward() });
  const handlers: Record<string, (event: Event) => void> = {
    "dom-ready": () => {
      ready.current = true;
      callbacks.current.onReport({ webContentsId: element.getWebContentsId(), ...history() });
    },
    "did-start-loading": () => callbacks.current.onReport({ loading: true, error: null }),
    "did-stop-loading": () =>
      callbacks.current.onReport({ loading: false, ...(ready.current ? history() : {}) }),
    "did-navigate": (event) => {
      callbacks.current.onNavigated((event as Event & { url: string }).url);
      if (ready.current) callbacks.current.onReport(history());
    },
    "did-navigate-in-page": (event) => {
      const { url, isMainFrame } = event as Event & { url: string; isMainFrame: boolean };
      if (!isMainFrame) return;
      callbacks.current.onNavigated(url);
      if (ready.current) callbacks.current.onReport(history());
    },
    "page-title-updated": (event) =>
      callbacks.current.onTitle((event as Event & { title: string }).title),
    "did-fail-load": (event) => {
      const { errorCode, errorDescription, validatedURL, isMainFrame } = event as Event & {
        errorCode: number;
        errorDescription: string;
        validatedURL: string;
        isMainFrame: boolean;
      };
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      callbacks.current.onReport({
        loading: false,
        error: { code: errorCode, description: errorDescription, url: validatedURL },
      });
    },
    "render-process-gone": () =>
      callbacks.current.onReport({
        loading: false,
        error: { code: 0, description: "PAGE_CRASHED", url: safeUrl(element) },
      }),
    // A click in the page reaches this document only as the webview taking focus, so a menu or
    // popover open in the app would never hear the click outside that closes it. (T3 Code's fix.)
    focus: () =>
      element.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
      ),
  };
  for (const [name, handler] of Object.entries(handlers)) element.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of Object.entries(handlers)) {
      element.removeEventListener(name, handler);
    }
  };
};

const safeUrl = (element: WebviewElement): string => {
  try {
    return element.getURL();
  } catch {
    return "";
  }
};
