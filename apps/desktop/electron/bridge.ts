import type { ElectronDesktopBridge } from "../src/backend/electron-backend";
import { IPC_CHANNELS } from "./channels";

export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export const createDesktopBridge = (invoke: IpcInvoke): ElectronDesktopBridge => ({
  getSetupState: () =>
    invoke(IPC_CHANNELS.getSetupState) as ReturnType<ElectronDesktopBridge["getSetupState"]>,
  runSetupAction: (actionId) =>
    invoke(IPC_CHANNELS.runSetupAction, actionId) as ReturnType<
      ElectronDesktopBridge["runSetupAction"]
    >,
  openSetupGuide: (actionId) => invoke(IPC_CHANNELS.openSetupGuide, actionId) as Promise<void>,
  startAopSidecar: () =>
    invoke(IPC_CHANNELS.startAopSidecar) as ReturnType<ElectronDesktopBridge["startAopSidecar"]>,
  getSidecarState: () =>
    invoke(IPC_CHANNELS.getSidecarState) as ReturnType<ElectronDesktopBridge["getSidecarState"]>,
  openLogsFolder: () => invoke(IPC_CHANNELS.openLogsFolder) as Promise<void>,
  quitApp: () => invoke(IPC_CHANNELS.quitApp) as Promise<void>,
  listWslDistros: () =>
    invoke(IPC_CHANNELS.listWslDistros) as ReturnType<ElectronDesktopBridge["listWslDistros"]>,
  getExecHost: () =>
    invoke(IPC_CHANNELS.getExecHost) as ReturnType<ElectronDesktopBridge["getExecHost"]>,
  setExecHost: (mode) => invoke(IPC_CHANNELS.setExecHost, mode) as Promise<void>,
  setZoom: (zoomFactor) => invoke(IPC_CHANNELS.setZoom, zoomFactor) as Promise<void>,
});
