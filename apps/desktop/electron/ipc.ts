import type {
  ConnectInput,
  ConnectResult,
  DesktopState,
  PairingCodeResult,
} from "../src/backend/types";
import { IPC_CHANNELS } from "./channels";
import { isAllowedNavigation, isDashboardSender, isShellSender } from "./security";

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
  getState: () => DesktopState;
  connectHost: (input: ConnectInput) => Promise<ConnectResult>;
  forgetHost: () => Promise<void>;
  startHostMode: () => Promise<void>;
  stopHostMode: () => Promise<void>;
  setServeOverTailscale: (enabled: boolean) => Promise<void>;
  createPairingCode: () => Promise<PairingCodeResult>;
  openDashboard: () => Promise<void>;
  reconnect: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  quitApp: () => Promise<void>;
  getHostConfig: () => Promise<{ baseUrl: string; token: string | null }>;
  hostRejected: () => Promise<void>;
  setZoom: (factor: number) => Promise<void>;
}

/**
 * Registers what a page may ask of the app. Who may ask is decided by the page's address, not
 * by anything it sends: the connect screen changes which host the app talks to, the bundled
 * dashboard only learns which one that is, and a page a host served has no bridge at all.
 */
export const registerDesktopIpc = (
  ipcMain: IpcMainLike,
  host: DesktopIpcHost,
  development: boolean,
): void => {
  const fromShell = (operation: (...args: unknown[]) => unknown): IpcHandler => {
    return async (event, ...args) => {
      assertSender(isShellSender(senderUrl(event), development));
      return operation(...args);
    };
  };
  const fromDashboard = (operation: (...args: unknown[]) => unknown): IpcHandler => {
    return async (event, ...args) => {
      assertSender(isDashboardSender(senderUrl(event)));
      return operation(...args);
    };
  };

  const shellHandlers: [string, (...args: unknown[]) => unknown][] = [
    [IPC_CHANNELS.getState, () => host.getState()],
    [IPC_CHANNELS.connectHost, (input) => host.connectHost(parseConnectInput(input))],
    [IPC_CHANNELS.forgetHost, () => host.forgetHost()],
    [IPC_CHANNELS.startHostMode, () => host.startHostMode()],
    [IPC_CHANNELS.stopHostMode, () => host.stopHostMode()],
    [
      IPC_CHANNELS.setServeOverTailscale,
      (enabled) => host.setServeOverTailscale(requiredBoolean(enabled)),
    ],
    [IPC_CHANNELS.createPairingCode, () => host.createPairingCode()],
    [IPC_CHANNELS.openDashboard, () => host.openDashboard()],
    [IPC_CHANNELS.reconnect, () => host.reconnect()],
    [IPC_CHANNELS.openLogsFolder, () => host.openLogsFolder()],
    [IPC_CHANNELS.quitApp, () => host.quitApp()],
  ];
  for (const [channel, operation] of shellHandlers)
    register(ipcMain, channel, fromShell(operation));

  register(
    ipcMain,
    IPC_CHANNELS.getHostConfig,
    fromDashboard(() => host.getHostConfig()),
  );
  register(
    ipcMain,
    IPC_CHANNELS.hostRejected,
    fromDashboard(() => host.hostRejected()),
  );

  register(ipcMain, IPC_CHANNELS.setZoom, async (event, factor) => {
    assertSender(isAllowedNavigation(senderUrl(event), development));
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

const assertSender = (allowed: boolean): void => {
  if (!allowed) throw new Error("Blocked desktop IPC sender.");
};

const senderUrl = (event: IpcEventLike): string =>
  event.senderUrl ?? event.senderFrame?.url ?? event.sender?.getURL() ?? "";

const MAX_INPUT_LENGTH = 300;

const parseConnectInput = (value: unknown): ConnectInput => {
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    url: requiredString(input.url, "host address"),
    code: requiredString(input.code, "pairing code"),
    deviceName: requiredString(input.deviceName, "device name"),
  };
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length > MAX_INPUT_LENGTH) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
};

const requiredBoolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("Invalid setting.");
  return value;
};
