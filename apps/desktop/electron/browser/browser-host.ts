import { join } from "node:path";
import type {
  BrowserDownload,
  BrowserDownloadAction,
  BrowserHostEvent,
  BrowserShortcut,
} from "@aop/common";
import type {
  BrowserWindowConstructorOptions,
  ContextMenuParams,
  DownloadItem,
  Input,
  MenuItemConstructorOptions,
  Session,
  WebContents,
} from "electron";
import type { Logger } from "../log";
import { pageContextMenu, windowContextMenu } from "./context-menus";
import { faviconDataUrl } from "./favicon";
import {
  downloadFileName,
  hardenGuestPreferences,
  isBlockedNavigation,
  isGuestAttachAllowed,
  permissionCheck,
  permissionDecision,
  popupDecision,
} from "./policy";
import { createPromptRegistry } from "./prompts";
import { browserShortcutFor, stepZoom, WINDOW_BROWSER_SHORTCUTS } from "./shortcuts";

/** The Electron pieces the browser needs, passed in so the wiring can be exercised without Electron. */
export interface BrowserHostDeps {
  platform: NodeJS.Platform;
  session: Session;
  /** Sends one event to the dashboard in the app's window. */
  send: (event: BrowserHostEvent) => void;
  isDashboardUrl: (url: string) => boolean;
  popupMenu: (template: MenuItemConstructorOptions[], owner: WebContents) => void;
  copyText: (text: string) => void;
  /** Opens a web link in the person's own browser (the app's window menu offers it). */
  openExternal: (url: string) => void;
  showItemInFolder: (path: string) => void;
  downloadsDir: () => string;
  fileExists: (path: string) => boolean;
  newId: () => string;
  log: Logger;
}

export interface BrowserHost {
  /** Gives the app's window the browser: its webview guests, its shortcuts, its link menu. */
  attachWindow: (window: WebContents) => void;
  setActive: (active: boolean) => void;
  answerPrompt: (id: string, allow: boolean) => void;
  downloadAction: (id: string, action: BrowserDownloadAction) => void;
}

/**
 * The main process's half of the AOP Browser. The dashboard draws the browser and owns its
 * `<webview>` guests; this decides what the guests may do (see policy.ts) and tells the dashboard
 * what only the main process sees: keys typed in a page, new tabs, permission requests, icons and
 * downloads. Modelled on T3 Code's preview browser (pingdotgg/t3code, apps/desktop/src/preview).
 */
export const createBrowserHost = (deps: BrowserHostDeps): BrowserHost => {
  const prompts = createPromptRegistry(deps.newId);
  const downloads = new Map<string, { item: DownloadItem; path: string }>();
  let active = false;

  configureSession(deps, prompts, downloads);

  const closePrompts = (guest: WebContents) => {
    for (const id of prompts.cancelFor(guest.id)) deps.send({ kind: "prompt-closed", id });
  };

  return {
    attachWindow: (window) => {
      window.on("will-attach-webview", (event, preferences, params) => {
        if (!isGuestAttachAllowed(params, deps.isDashboardUrl(window.getURL()))) {
          event.preventDefault();
          deps.log("browser webview refused", { partition: params.partition });
          return;
        }
        hardenGuestPreferences(preferences);
      });
      window.on("did-attach-webview", (_event, guest) => wireGuest(guest, deps, closePrompts));
      window.on("before-input-event", (event, input) => {
        const shortcut = active ? browserShortcutFor(input, deps.platform) : null;
        if (!shortcut || !WINDOW_BROWSER_SHORTCUTS.has(shortcut)) return;
        event.preventDefault();
        deps.send({ kind: "shortcut", shortcut, webContentsId: null });
      });
      // A reload or the connect screen ends whatever the dashboard said about the browser.
      window.on("did-navigate", () => {
        active = false;
      });
      window.on("context-menu", (_event, params) => {
        if (!deps.isDashboardUrl(window.getURL())) return;
        const template = windowContextMenu(params, {
          openInBrowser: (url) => deps.send({ kind: "open-tab", url, webContentsId: null }),
          openExternal: deps.openExternal,
          copyText: deps.copyText,
        });
        if (template.length > 0) deps.popupMenu(template, window);
      });
    },
    setActive: (next) => {
      active = next;
    },
    answerPrompt: (id, allow) => {
      if (prompts.answer(id, allow)) deps.send({ kind: "prompt-closed", id });
    },
    downloadAction: (id, action) => {
      const download = downloads.get(id);
      if (!download) return;
      if (action === "cancel") download.item.cancel();
      else if (download.item.getState() === "completed") deps.showItemInFolder(download.path);
    },
  };
};

type Prompts = ReturnType<typeof createPromptRegistry>;
type Downloads = Map<string, { item: DownloadItem; path: string }>;

/** One page: its new windows, its navigations, its keys, its right click and its icon. */
const wireGuest = (
  guest: WebContents,
  deps: BrowserHostDeps,
  closePrompts: (guest: WebContents) => void,
): void => {
  guest.setWindowOpenHandler((details) => {
    const decision = popupDecision(details);
    if (decision === "popup") return { action: "allow", overrideBrowserWindowOptions: POPUP };
    if (decision === "tab")
      deps.send({ kind: "open-tab", url: details.url, webContentsId: guest.id });
    return { action: "deny" };
  });
  guest.on("did-create-window", (popup) => {
    // A sign-in popup needs nothing further; the chain of windows stops at the first.
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    guardNavigation(popup.webContents);
  });
  guardNavigation(guest);
  guest.on("before-input-event", (event, input) => onGuestKey(guest, deps, event, input));
  guest.on("context-menu", (_event, params) => {
    const host = guest.hostWebContents;
    if (host) deps.popupMenu(guestMenu(guest, params, deps), host);
  });
  guest.on("page-favicon-updated", (_event, favicons) => {
    void faviconDataUrl(favicons, (url) => guest.session.fetch(url)).then((dataUrl) => {
      if (dataUrl && !guest.isDestroyed()) {
        deps.send({ kind: "favicon", webContentsId: guest.id, dataUrl });
      }
    });
  });
  // A new page is not the one that asked.
  guest.on("did-navigate", () => closePrompts(guest));
  guest.once("destroyed", () => closePrompts(guest));
};

const guardNavigation = (contents: WebContents): void => {
  const guard = (event: { preventDefault: () => void }, url: string) => {
    if (isBlockedNavigation(url)) event.preventDefault();
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
};

const onGuestKey = (
  guest: WebContents,
  deps: BrowserHostDeps,
  event: { preventDefault: () => void },
  input: Input,
): void => {
  const shortcut = browserShortcutFor(input, deps.platform);
  if (!shortcut) return;
  event.preventDefault();
  if (isZoom(shortcut)) guest.setZoomFactor(stepZoom(guest.getZoomFactor(), shortcut));
  else deps.send({ kind: "shortcut", shortcut, webContentsId: guest.id });
};

const isZoom = (
  shortcut: BrowserShortcut,
): shortcut is Extract<BrowserShortcut, "zoom-in" | "zoom-out" | "zoom-reset"> =>
  shortcut === "zoom-in" || shortcut === "zoom-out" || shortcut === "zoom-reset";

const guestMenu = (guest: WebContents, params: ContextMenuParams, deps: BrowserHostDeps) =>
  pageContextMenu(params, {
    canGoBack: guest.navigationHistory.canGoBack(),
    canGoForward: guest.navigationHistory.canGoForward(),
    back: () => guest.navigationHistory.goBack(),
    forward: () => guest.navigationHistory.goForward(),
    reload: () => guest.reload(),
    openInNewTab: (url) => deps.send({ kind: "open-tab", url, webContentsId: guest.id }),
    copyText: deps.copyText,
    copyImage: () => guest.copyImageAt(params.x, params.y),
    inspect: () => guest.inspectElement(params.x, params.y),
  });

// A popup a page opens: the same posture as the page, and the same session (Electron gives a
// child window its opener's), with no preload. Its size is what the page asked for.
const POPUP: BrowserWindowConstructorOptions = {
  autoHideMenuBar: true,
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
  },
};

const configureSession = (deps: BrowserHostDeps, prompts: Prompts, downloads: Downloads) => {
  const { session } = deps;
  session.setPermissionRequestHandler((contents, permission, callback, request) => {
    const details = request as {
      mediaTypes?: string[];
      externalURL?: string;
      requestingUrl?: string;
    };
    const decision = permissionDecision(permission, details);
    if (decision.decision !== "ask") return callback(decision.decision === "allow");
    // Only a page in a tab can show the question; a popup's request is refused.
    if (!contents?.hostWebContents) return callback(false);
    const prompt = prompts.ask(
      {
        webContentsId: contents.id,
        origin: originOf(details.requestingUrl ?? contents.getURL()),
        ask: decision.ask,
        ...(decision.ask === "open-external" ? { externalUrl: details.externalURL } : {}),
      },
      callback,
    );
    if (prompt) deps.send({ kind: "prompt", prompt });
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    permissionCheck(permission, details.mediaType, (ask) =>
      prompts.granted(originOf(requestingOrigin), ask),
    ),
  );
  session.setDevicePermissionHandler(() => false);
  session.on("will-download", (_event, item, contents) =>
    startDownload(deps, downloads, item, contents),
  );
};

/**
 * Straight into the Downloads folder, as Chrome does by default: without a save path Electron
 * would put a modal Save dialog over the whole app.
 */
const startDownload = (
  deps: BrowserHostDeps,
  downloads: Downloads,
  item: DownloadItem,
  contents: WebContents,
): void => {
  const dir = deps.downloadsDir();
  const taken = new Set([...downloads.values()].map(({ path }) => path));
  const filename = downloadFileName(item.getFilename(), (name) => {
    const path = join(dir, name);
    return taken.has(path) || deps.fileExists(path);
  });
  const path = join(dir, filename);
  item.setSavePath(path);
  const id = deps.newId();
  downloads.set(id, { item, path });
  const report = (state: BrowserDownload["state"] = item.getState()) =>
    deps.send({
      kind: "download",
      download: {
        id,
        webContentsId: contents.id,
        filename,
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      },
    });
  let lastReport = 0;
  item.on("updated", () => {
    const now = Date.now();
    if (now - lastReport < 250) return;
    lastReport = now;
    report();
  });
  item.once("done", (_event, state) => {
    report(state);
    deps.log("browser download", { filename, state });
  });
  report();
};

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};
