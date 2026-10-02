import { useEffect, useRef } from "react";
import { desktopBrowser } from "./desktop-browser";
import { openBrowserView, toggleBrowserView } from "./open-browser-view";

/**
 * The project screen's side of the browser: its ways in (see useBrowserEntryPoints), the column
 * back from a panel that covers it when the browser opens (as a pull request does), and the top
 * bar's button, which only the desktop app has.
 */
export const useBrowserScreen = (
  projectId: string,
  shown: boolean,
  revealChat: () => void,
): { shown: boolean; toggle: () => void } | undefined => {
  useBrowserEntryPoints(projectId);
  const reveal = useRef(revealChat);
  reveal.current = revealChat;
  useEffect(() => {
    if (shown) reveal.current();
  }, [shown]);
  return desktopBrowser() ? { shown, toggle: () => toggleBrowserView(projectId) } : undefined;
};

/**
 * The project screen's way into its browser, in the desktop app only: ⌘⇧B (Ctrl+Shift+B) shows
 * or hides it, and "Open in AOP Browser" from the window's right-click menu on a link opens the
 * link in it.
 */
export const useBrowserEntryPoints = (projectId: string): void => {
  useEffect(() => {
    const bridge = desktopBrowser();
    if (!bridge) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleShortcut(event) || event.defaultPrevented) return;
      event.preventDefault();
      toggleBrowserView(projectId);
    };
    window.addEventListener("keydown", onKeyDown);
    const stop = bridge.onEvent((event) => {
      if (event.kind === "open-tab" && event.webContentsId === null) {
        openBrowserView({ projectId, url: event.url });
      }
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stop();
    };
  }, [projectId]);
};

export const isToggleShortcut = (
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean =>
  event.code === "KeyB" && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey;
