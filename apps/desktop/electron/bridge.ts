import type { AppUpdateState, BrowserHostEvent, DesktopAppInfo } from "@aop/common";
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
  onOpenSettings: heldSignal(subscribe, IPC_CHANNELS.openSettings),
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
  getAppInfo: () => invoke(IPC_CHANNELS.getAppInfo) as Promise<DesktopAppInfo>,
  getUpdateState: () => invoke(IPC_CHANNELS.getUpdateState) as Promise<AppUpdateState>,
  onUpdateStateChanged: (listener) =>
    subscribe(IPC_CHANNELS.updateStateChanged, (payload) => listener(payload as AppUpdateState)),
  checkForUpdates: () => invoke(IPC_CHANNELS.checkForUpdates) as Promise<AppUpdateState>,
  downloadAndRestart: () => invoke(IPC_CHANNELS.downloadAndRestart) as Promise<void>,
  openUpdateDownload: () => invoke(IPC_CHANNELS.openUpdateDownload) as Promise<void>,
  restartToUpdate: () => invoke(IPC_CHANNELS.restartToUpdate) as Promise<void>,
  setAutoDownload: (enabled) => invoke(IPC_CHANNELS.setAutoDownload, enabled) as Promise<void>,
  onOpenUpdates: heldSignal(subscribe, IPC_CHANNELS.openUpdates),
  onOpenHostSetup: heldSignal(subscribe, IPC_CHANNELS.openHostSetup),
  browser: {
    onEvent: (listener) =>
      subscribe(IPC_CHANNELS.browserEvent, (payload) => listener(payload as BrowserHostEvent)),
    setActive: (active) => invoke(IPC_CHANNELS.browserSetActive, active) as Promise<void>,
    answerPrompt: (id, allow) =>
      invoke(IPC_CHANNELS.browserAnswerPrompt, { id, allow }) as Promise<void>,
    downloadAction: (id, action) =>
      invoke(IPC_CHANNELS.browserDownloadAction, { id, action }) as Promise<void>,
  },
});

/**
 * A signal from the app that waits for its listener: the app may send it while the page is still
 * starting, so it is heard from the moment the preload runs and handed over once someone listens.
 */
const heldSignal = (subscribe: IpcSubscribe, channel: string) => {
  let listener: (() => void) | null = null;
  let held = false;
  subscribe(channel, () => {
    if (listener) listener();
    else held = true;
  });
  return (next: () => void): (() => void) => {
    listener = next;
    if (held) {
      held = false;
      next();
    }
    return () => {
      if (listener === next) listener = null;
    };
  };
};
