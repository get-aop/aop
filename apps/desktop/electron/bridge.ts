import type { ElectronDesktopBridge } from "../src/backend/electron-backend";
import type {
  ConnectInput,
  ConnectResult,
  DesktopState,
  PairingCodeResult,
} from "../src/backend/types";
import { IPC_CHANNELS } from "./channels";

export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type IpcSubscribe = (channel: string, listener: (payload: unknown) => void) => () => void;

/** Builds the object the preload script exposes to a page. Each method is one IPC round trip. */
export const createDesktopBridge = (
  invoke: IpcInvoke,
  subscribe: IpcSubscribe,
): ElectronDesktopBridge => ({
  getState: () => invoke(IPC_CHANNELS.getState) as Promise<DesktopState>,
  onStateChanged: (listener) =>
    subscribe(IPC_CHANNELS.stateChanged, (payload) => listener(payload as DesktopState)),
  connectHost: (input: ConnectInput) =>
    invoke(IPC_CHANNELS.connectHost, input) as Promise<ConnectResult>,
  forgetHost: () => invoke(IPC_CHANNELS.forgetHost) as Promise<void>,
  startHostMode: () => invoke(IPC_CHANNELS.startHostMode) as Promise<void>,
  stopHostMode: () => invoke(IPC_CHANNELS.stopHostMode) as Promise<void>,
  setServeOverTailscale: (enabled) =>
    invoke(IPC_CHANNELS.setServeOverTailscale, enabled) as Promise<void>,
  createPairingCode: () => invoke(IPC_CHANNELS.createPairingCode) as Promise<PairingCodeResult>,
  openDashboard: () => invoke(IPC_CHANNELS.openDashboard) as Promise<void>,
  reconnect: () => invoke(IPC_CHANNELS.reconnect) as Promise<void>,
  openLogsFolder: () => invoke(IPC_CHANNELS.openLogsFolder) as Promise<void>,
  quitApp: () => invoke(IPC_CHANNELS.quitApp) as Promise<void>,
  getHostConfig: () =>
    invoke(IPC_CHANNELS.getHostConfig) as ReturnType<ElectronDesktopBridge["getHostConfig"]>,
  hostRejected: () => invoke(IPC_CHANNELS.hostRejected) as Promise<void>,
  setZoom: (zoomFactor) => invoke(IPC_CHANNELS.setZoom, zoomFactor) as Promise<void>,
});
