import { mock } from "bun:test";
import type {
  AppUpdateState,
  ConnectResult,
  DesktopBackend,
  DesktopState,
  PairingCodeResult,
} from "../backend/types";

export const makeState = (overrides: Partial<DesktopState> = {}): DesktopState => ({
  appVersion: "0.9.51",
  platform: "darwin",
  mode: null,
  remoteUrl: null,
  connection: { status: "unconfigured" },
  hostProcess: { status: "stopped" },
  hostModeAvailable: true,
  localPort: 25150,
  serveOverTailscale: false,
  tailscale: {
    serveCommand: "tailscale serve --bg --https=443 http://127.0.0.1:25150",
    resetCommand: "tailscale serve reset",
  },
  defaultDeviceName: "Marcelo's MacBook",
  ...overrides,
});

/** A backend whose answers a test sets, and whose pushed state changes it can send by hand. */
export const createFakeBackend = (
  initial: DesktopState = makeState(),
  initialUpdate: AppUpdateState = { status: "idle", checkedAt: null },
) => {
  let state = initial;
  const listeners = new Set<(state: DesktopState) => void>();
  let update = initialUpdate;
  const updateListeners = new Set<(state: AppUpdateState) => void>();
  const backend = {
    getState: mock(async () => state),
    onStateChanged: mock((listener: (state: DesktopState) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    connectHost: mock(async (): Promise<ConnectResult> => ({ ok: true })),
    forgetHost: mock(async () => {}),
    startHostMode: mock(async () => {}),
    stopHostMode: mock(async () => {}),
    setServeOverTailscale: mock(async (_enabled: boolean) => {}),
    createPairingCode: mock(
      async (): Promise<PairingCodeResult> => ({
        ok: true,
        code: "K7QM-4XNP",
        expiresAt: "2026-09-30T12:10:00.000Z",
      }),
    ),
    openDashboard: mock(async () => {}),
    reconnect: mock(async () => {}),
    openLogsFolder: mock(async () => {}),
    quitApp: mock(async () => {}),
    getAppInfo: mock(async () => ({
      name: "AOP",
      version: state.appVersion,
      platform: state.platform,
      autoDownload: true,
    })),
    getUpdateState: mock(async () => update),
    onUpdateStateChanged: mock((listener: (state: AppUpdateState) => void) => {
      updateListeners.add(listener);
      return () => void updateListeners.delete(listener);
    }),
    checkForUpdates: mock(async () => update),
    downloadAndRestart: mock(async () => {}),
    openUpdateDownload: mock(async () => {}),
    restartToUpdate: mock(async () => {}),
    setAutoDownload: mock(async (_enabled: boolean) => {}),
  } satisfies DesktopBackend;
  return {
    backend,
    /** The app pushes a new state, as it does when the connection or the host process changes. */
    push: (next: DesktopState) => {
      state = next;
      for (const listener of listeners) listener(next);
    },
    /** The app pushes a change to its own update. */
    pushUpdate: (next: AppUpdateState) => {
      update = next;
      for (const listener of updateListeners) listener(next);
    },
    listenerCount: () => listeners.size,
  };
};
