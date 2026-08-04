import type { DesktopSetupState } from "../setup/types";

export type SidecarStatus = "idle" | "starting" | "ready" | "failed";

export interface SidecarState {
  status: SidecarStatus;
  dashboardUrl?: string;
  logPath?: string;
  message?: string;
}

export interface WslDistro {
  name: string;
  isDefault: boolean;
  running: boolean;
  version: number;
}

export interface DesktopBackend {
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
}
