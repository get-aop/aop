import type { DesktopAppUpdateBridge, DesktopBrowserBridge } from "@aop/common";
import type { DesktopBackend } from "./types";

/** The dashboard's half of the preload bridge: which host to use, a refused token, its browser. */
export interface DashboardBridge {
  getHostConfig: () => Promise<{ baseUrl: string; token: string | null }>;
  hostRejected: () => Promise<void>;
  setZoom: (zoomFactor: number) => Promise<void>;
  /**
   * The app menu's Settings… (⌘,). A choice made before the dashboard listens (the menu can load
   * the dashboard first) is kept and handed to the first listener. So are `onOpenUpdates` (Check
   * for Updates…) and `onOpenHostSetup` (Host Setup…).
   */
  onOpenSettings: (listener: () => void) => () => void;
  browser: DesktopBrowserBridge;
}

/**
 * Everything the preload script exposes as `window.aopDesktop`. Each page may use its own half;
 * "This app"'s update (DesktopAppUpdateBridge) is open to both, so the bundled dashboard's
 * Updates popover and the app's own screens show the same row.
 */
export interface ElectronDesktopBridge
  extends DesktopBackend,
    DashboardBridge,
    DesktopAppUpdateBridge {}

declare global {
  interface Window {
    aopDesktop?: ElectronDesktopBridge;
  }
}

export const electronBackend = (): DesktopBackend => {
  if (!window.aopDesktop) throw new Error("AOP Desktop preload bridge is unavailable.");
  return window.aopDesktop;
};
