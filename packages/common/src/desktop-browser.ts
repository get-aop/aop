/**
 * The AOP Browser: a Chromium browser the desktop app shows in the coordinator panel. Its pages
 * are `<webview>` guests of the bundled dashboard, so the dashboard draws the browser's chrome and
 * the app's main process owns what a page may not decide alone: shortcuts typed inside a page,
 * new windows, permission requests, other apps' links and downloads. These are the messages
 * between the two. A plain browser on a paired device has no AOP Browser.
 */

/**
 * The guests' session: their own cookies and storage, apart from the dashboard's, kept on disk
 * so logins survive a restart. The app refuses a webview on any other partition.
 */
export const AOP_BROWSER_PARTITION = "persist:aop-browser";

/** A browser shortcut, typed in a page or in the app's window while the browser is shown. */
export type BrowserShortcut =
  | "toggle-browser"
  | "focus-address"
  | "reload"
  | "hard-reload"
  | "back"
  | "forward"
  | "devtools"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "previous-tab"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset";

/** What a page asks for that the person decides: a device, their place, notifications, another app. */
export type BrowserAsk =
  | "camera"
  | "microphone"
  | "camera-and-microphone"
  | "geolocation"
  | "notifications"
  | "open-external";

/** A page's request waiting on the person. `externalUrl` is the link another app would open. */
export interface BrowserPrompt {
  id: string;
  webContentsId: number;
  origin: string;
  ask: BrowserAsk;
  externalUrl?: string;
}

export type BrowserDownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

/** A file a page is saving into the person's Downloads folder. */
export interface BrowserDownload {
  id: string;
  webContentsId: number;
  filename: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
}

/**
 * The app to the dashboard. `webContentsId` names the page (a guest's id); `null` means the app's
 * own window: a shortcut typed in the dashboard, or a link opened from its context menu.
 */
export type BrowserHostEvent =
  | { kind: "shortcut"; shortcut: BrowserShortcut; webContentsId: number | null }
  | { kind: "open-tab"; url: string; webContentsId: number | null }
  | { kind: "favicon"; webContentsId: number; dataUrl: string }
  | { kind: "prompt"; prompt: BrowserPrompt }
  | { kind: "prompt-closed"; id: string }
  | { kind: "download"; download: BrowserDownload };

export type BrowserDownloadAction = "reveal" | "cancel";

/** The browser half of the desktop app's preload bridge, as the dashboard sees it. */
export interface DesktopBrowserBridge {
  onEvent: (listener: (event: BrowserHostEvent) => void) => () => void;
  /** The browser is shown (or not): while it is, the app's window sends its shortcuts here. */
  setActive: (active: boolean) => Promise<void>;
  answerPrompt: (id: string, allow: boolean) => Promise<void>;
  downloadAction: (id: string, action: BrowserDownloadAction) => Promise<void>;
}
