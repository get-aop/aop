import type { DesktopBrowserBridge } from "@aop/common";

/**
 * The desktop app's browser bridge, or null in a plain browser (a paired device, the dev
 * dashboard). Without it there is no AOP Browser: nothing can embed an arbitrary site there (most
 * refuse to be framed), and `localhost` would mean the device, not the host's machine.
 */
export const desktopBrowser = (): DesktopBrowserBridge | null => {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { aopDesktop?: { browser?: Partial<DesktopBrowserBridge> } })
    .aopDesktop?.browser;
  return typeof bridge?.onEvent === "function" &&
    typeof bridge.setActive === "function" &&
    typeof bridge.answerPrompt === "function" &&
    typeof bridge.downloadAction === "function"
    ? (bridge as DesktopBrowserBridge)
    : null;
};
