import type { DesktopSetupState } from "../setup/types";
import type { DesktopBackend, SidecarState, WslDistro } from "./types";

export interface ElectronDesktopBridge {
  getSetupState: () => Promise<DesktopSetupState>;
  runSetupAction: (actionId: string) => Promise<DesktopSetupState>;
  openSetupGuide: (actionId: string) => Promise<void>;
  startAopSidecar: () => Promise<SidecarState>;
  getSidecarState: () => Promise<SidecarState>;
  openLogsFolder: () => Promise<void>;
  quitApp: () => Promise<void>;
  listWslDistros: () => Promise<WslDistro[]>;
  getExecHost: () => Promise<string>;
  setExecHost: (mode: string) => Promise<void>;
  setZoom: (zoomFactor: number) => Promise<void>;
}

declare global {
  interface Window {
    aopDesktop?: ElectronDesktopBridge;
  }
}

export const createElectronBackend = (bridge: ElectronDesktopBridge): DesktopBackend => ({
  getSetupState: bridge.getSetupState,
  runSetupAction: bridge.runSetupAction,
  openSetupGuide: bridge.openSetupGuide,
  startAopSidecar: bridge.startAopSidecar,
  getSidecarState: bridge.getSidecarState,
  openLogsFolder: bridge.openLogsFolder,
  quitApp: bridge.quitApp,
  listWslDistros: bridge.listWslDistros,
  getExecHost: bridge.getExecHost,
  setExecHost: bridge.setExecHost,
});

export const electronBackend = (): DesktopBackend => {
  if (!window.aopDesktop) throw new Error("AOP Desktop preload bridge is unavailable.");
  return createElectronBackend(window.aopDesktop);
};
