import { EventEmitter } from "node:events";
import type { BrowserHostEvent } from "@aop/common";
import type { BrowserHostDeps } from "./browser-host";

type Handler = (...args: never[]) => unknown;

/** A WebContents as far as the browser host uses one: events, a URL, an id. */
export class FakeContents extends EventEmitter {
  windowOpenHandler: Handler | null = null;
  zoom = 1;
  hostWebContents: FakeContents | null = null;
  readonly session = { fetch: async () => new Response(null, { status: 404 }) };
  readonly navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goForward: () => {},
  };

  constructor(
    readonly id: number,
    private url = "",
  ) {
    super();
  }

  getURL = () => this.url;
  isDestroyed = () => false;
  setWindowOpenHandler = (handler: Handler) => {
    this.windowOpenHandler = handler;
  };
  getZoomFactor = () => this.zoom;
  setZoomFactor = (factor: number) => {
    this.zoom = factor;
  };
  reload = () => {};
  copyImageAt = () => {};
  inspectElement = () => {};
}

/** A DownloadItem: its name, its state, and the path the host gives it. */
export class FakeDownload extends EventEmitter {
  savePath = "";
  state = "progressing";
  cancelled = false;

  constructor(private filename: string) {
    super();
  }

  getFilename = () => this.filename;
  setSavePath = (path: string) => {
    this.savePath = path;
  };
  getState = () => this.state;
  getReceivedBytes = () => 4;
  getTotalBytes = () => 8;
  cancel = () => {
    this.cancelled = true;
  };
}

/** The browser's session: its handlers, kept so a test can call them as Chromium would. */
export class FakeSession extends EventEmitter {
  requestHandler: Handler | null = null;
  checkHandler: Handler | null = null;
  deviceHandler: Handler | null = null;
  setPermissionRequestHandler = (handler: Handler) => {
    this.requestHandler = handler;
  };
  setPermissionCheckHandler = (handler: Handler) => {
    this.checkHandler = handler;
  };
  setDevicePermissionHandler = (handler: Handler) => {
    this.deviceHandler = handler;
  };
}

export const fakeBrowserDeps = (existing: string[] = []) => {
  const sent: BrowserHostEvent[] = [];
  const revealed: string[] = [];
  const session = new FakeSession();
  let id = 0;
  const deps = {
    platform: "darwin",
    session,
    send: (event: BrowserHostEvent) => {
      sent.push(event);
    },
    isDashboardUrl: (url: string) => url.startsWith("app://aop"),
    popupMenu: () => {},
    copyText: () => {},
    openExternal: () => {},
    showItemInFolder: (path: string) => {
      revealed.push(path);
    },
    downloadsDir: () => "/Users/me/Downloads",
    fileExists: (path: string) => existing.includes(path),
    newId: () => `id${++id}`,
    log: () => {},
  } as unknown as BrowserHostDeps;
  return { deps, sent, revealed, session };
};
