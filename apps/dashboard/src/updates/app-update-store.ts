import type { AppUpdateState, DesktopAppInfo, DesktopAppUpdateBridge } from "@aop/common";
import { useSyncExternalStore } from "react";

/**
 * "This app": the desktop app the dashboard runs in, through the bridge its preload exposes. In a
 * browser there is no bridge and nothing here (a browser gets its dashboard from the host, so it
 * updates with the host).
 */
export interface AppUpdatesState {
  info: DesktopAppInfo | null;
  update: AppUpdateState | null;
  /** Why the last call to the app failed. */
  error: string | null;
}

const INITIAL: AppUpdatesState = { info: null, update: null, error: null };

let state: AppUpdatesState = INITIAL;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

export const useAppUpdates = (): AppUpdatesState => useSyncExternalStore(subscribe, () => state);

/** The app's bridge, when the dashboard runs inside the desktop app and it has the update calls. */
export const appUpdateBridge = (): Partial<DesktopAppUpdateBridge> | null => {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { aopDesktop?: Partial<DesktopAppUpdateBridge> }).aopDesktop;
  return bridge?.getAppInfo && bridge.getUpdateState ? bridge : null;
};

/** Reads the app's version and update state, and follows the state from then on. */
export const startAppUpdates = async (): Promise<void> => {
  const bridge = appUpdateBridge();
  if (!bridge?.getAppInfo || !bridge.getUpdateState) return;
  if (!stopListening && bridge.onUpdateStateChanged) {
    stopListening = bridge.onUpdateStateChanged((update) => publish({ update }));
  }
  try {
    publish({ info: await bridge.getAppInfo(), update: await bridge.getUpdateState() });
  } catch (error) {
    publish({ error: messageOf(error) });
  }
};

export const checkForAppUpdate = (): Promise<void> =>
  call(async (bridge) => {
    if (bridge.checkForUpdates) publish({ update: await bridge.checkForUpdates() });
  });

export const restartAppToUpdate = (): Promise<void> =>
  call(async (bridge) => bridge.restartToUpdate?.());

export const downloadAndRestartApp = (): Promise<void> =>
  call(async (bridge) => bridge.downloadAndRestart?.());

export const openAppDownload = (): Promise<void> =>
  call(async (bridge) => bridge.openUpdateDownload?.());

export const setAppAutoDownload = (enabled: boolean): Promise<void> =>
  call(async (bridge) => {
    await bridge.setAutoDownload?.(enabled);
    if (bridge.getAppInfo) publish({ info: await bridge.getAppInfo() });
  });

/** Test seam: forget the app. */
export const resetAppUpdatesForTests = (): void => {
  stopListening?.();
  stopListening = null;
  state = INITIAL;
  for (const listener of listeners) listener();
};

const call = async (
  run: (bridge: Partial<DesktopAppUpdateBridge>) => Promise<unknown>,
): Promise<void> => {
  const bridge = appUpdateBridge();
  if (!bridge) return;
  publish({ error: null });
  try {
    await run(bridge);
  } catch (error) {
    publish({ error: messageOf(error) });
  }
};

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "This app did not answer.";

const publish = (patch: Partial<AppUpdatesState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
