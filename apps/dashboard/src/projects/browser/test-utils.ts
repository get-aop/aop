import type { BrowserHostEvent, DesktopBrowserBridge } from "@aop/common";

/** A desktop app's browser bridge that records what the dashboard asks and lets a test push events. */
export const installFakeBrowserBridge = () => {
  const listeners = new Set<(event: BrowserHostEvent) => void>();
  const calls: unknown[][] = [];
  const bridge: DesktopBrowserBridge = {
    onEvent: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setActive: async (active) => void calls.push(["setActive", active]),
    answerPrompt: async (id, allow) => void calls.push(["answerPrompt", id, allow]),
    downloadAction: async (id, action) => void calls.push(["downloadAction", id, action]),
  };
  const host = window as Window & { aopDesktop?: { browser: DesktopBrowserBridge } };
  host.aopDesktop = { browser: bridge };
  return {
    calls,
    emit: (event: BrowserHostEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
    uninstall: () => {
      delete host.aopDesktop;
    },
  };
};

/**
 * What an Electron `<webview>` does once its guest is ready, so the pane hears it: an id, its
 * history, and the events a page sends.
 */
export const readyWebview = (element: Element, webContentsId: number) => {
  const webview = element as HTMLElement & Record<string, unknown>;
  const loaded: string[] = [];
  Object.assign(webview, {
    getWebContentsId: () => webContentsId,
    canGoBack: () => true,
    canGoForward: () => false,
    loadURL: async (url: string) => void loaded.push(url),
    getURL: () => "",
  });
  const send = (name: string, fields: Record<string, unknown> = {}) =>
    webview.dispatchEvent(Object.assign(new Event(name), fields));
  send("dom-ready");
  return { send, loaded };
};
