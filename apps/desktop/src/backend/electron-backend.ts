import type { DesktopBrowserBridge } from "@aop/common";
import type { DesktopBackend } from "./types";

/** The dashboard's half of the preload bridge: which host to use, a refused token, its browser. */
export interface DashboardBridge {
  getHostConfig: () => Promise<{ baseUrl: string; token: string | null }>;
  hostRejected: () => Promise<void>;
  setZoom: (zoomFactor: number) => Promise<void>;
  browser: DesktopBrowserBridge;
}

/**
 * Everything the preload script exposes as `window.aopDesktop`. Each page may use its own half;
 * the app's update (`getUpdateState`, `onUpdateStateChanged`, `openUpdateDownload`,
 * `restartToUpdate`) is open to both, so the bundled dashboard can show it too.
 */
export interface ElectronDesktopBridge extends DesktopBackend, DashboardBridge {}

declare global {
  interface Window {
    aopDesktop?: ElectronDesktopBridge;
  }
}

export const electronBackend = (): DesktopBackend => {
  if (!window.aopDesktop) throw new Error("AOP Desktop preload bridge is unavailable.");
  return window.aopDesktop;
};
