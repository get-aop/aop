import type { SidecarState, WslDistro } from "../src/backend/types";
import type { DesktopSetupState } from "../src/setup/types";
import { IPC_CHANNELS } from "./channels";
import { isAllowedDesktopSender, isAllowedNavigation } from "./security";

interface IpcEventLike {
  senderUrl?: string;
  senderFrame?: { url: string } | null;
  sender?: { getURL: () => string };
}

type IpcHandler = (event: IpcEventLike, ...args: unknown[]) => Promise<unknown>;

interface IpcMainLike {
  handle: (channel: string, handler: IpcHandler) => unknown;
  removeHandler: (channel: string) => unknown;
}

export interface DesktopIpcHost {
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
  setZoom: (factor: number) => Promise<void>;
}

export const registerDesktopIpc = (
  ipcMain: IpcMainLike,
  host: DesktopIpcHost,
  development: boolean,
): void => {
  register(ipcMain, IPC_CHANNELS.getSetupState, setupOnly(development, host.getSetupState));
  register(
    ipcMain,
    IPC_CHANNELS.runSetupAction,
    setupOnly(development, (actionId) =>
      host.runSetupAction(requiredString(actionId, "action id")),
    ),
  );
  register(
    ipcMain,
    IPC_CHANNELS.openSetupGuide,
    setupOnly(development, (actionId) =>
      host.openSetupGuide(requiredString(actionId, "action id")),
    ),
  );
  register(ipcMain, IPC_CHANNELS.startAopSidecar, setupOnly(development, host.startAopSidecar));
  register(ipcMain, IPC_CHANNELS.getSidecarState, setupOnly(development, host.getSidecarState));
  register(ipcMain, IPC_CHANNELS.openLogsFolder, setupOnly(development, host.openLogsFolder));
  register(ipcMain, IPC_CHANNELS.quitApp, setupOnly(development, host.quitApp));
  register(ipcMain, IPC_CHANNELS.listWslDistros, setupOnly(development, host.listWslDistros));
  register(ipcMain, IPC_CHANNELS.getExecHost, setupOnly(development, host.getExecHost));
  register(
    ipcMain,
    IPC_CHANNELS.setExecHost,
    setupOnly(development, (mode) => host.setExecHost(requiredString(mode, "execution host"))),
  );
  register(ipcMain, IPC_CHANNELS.setZoom, async (event, factor) => {
    assertNavigationSender(event, development);
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0.7 || factor > 1.5) {
      throw new Error("Invalid zoom factor.");
    }
    await host.setZoom(factor);
  });
};

const register = (ipcMain: IpcMainLike, channel: string, handler: IpcHandler): void => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
};

const setupOnly =
  (development: boolean, operation: (...args: unknown[]) => Promise<unknown>): IpcHandler =>
  async (event, ...args) => {
    assertSetupSender(event, development);
    return operation(...args);
  };

const assertSetupSender = (event: IpcEventLike, development: boolean): void => {
  if (!isAllowedDesktopSender(senderUrl(event), development)) {
    throw new Error("Blocked desktop IPC sender.");
  }
};

const assertNavigationSender = (event: IpcEventLike, development: boolean): void => {
  if (!isAllowedNavigation(senderUrl(event), development)) {
    throw new Error("Blocked desktop IPC sender.");
  }
};

const senderUrl = (event: IpcEventLike): string =>
  event.senderUrl ?? event.senderFrame?.url ?? event.sender?.getURL() ?? "";

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
};
