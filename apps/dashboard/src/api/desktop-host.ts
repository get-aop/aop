import { type HostConfig, setManagedHostConfig } from "./host";
import { onUnauthenticated } from "./request";

/** The part of the desktop app's preload bridge that decides which host this dashboard talks to. */
export interface DesktopHostBridge {
  getHostConfig: () => Promise<HostConfig>;
  /** The host refused this device's token: the app returns to its connect screen. */
  hostRejected: () => Promise<void>;
}

/**
 * Inside the desktop app the dashboard is bundled and served from `app://aop`, so it has no
 * host of its own to default to. The app's main process decides which host to use and keeps
 * its token in the OS keychain; this asks for both before the first request and holds them in
 * memory. Outside the desktop app there is no bridge and nothing changes.
 *
 * A failure leaves the dashboard on its own origin, where its first request fails and the app
 * shows "Cannot reach the AOP host" with a retry, rather than a blank window.
 */
export const bootstrapDesktopHost = async (
  bridge: Partial<DesktopHostBridge> | undefined = desktopBridge(),
): Promise<void> => {
  if (!bridge?.getHostConfig || !bridge.hostRejected) return;
  const { hostRejected } = bridge;
  try {
    setManagedHostConfig(await bridge.getHostConfig());
  } catch {
    return;
  }
  // A revoked or unknown token is settled by pairing again, which only the app can do.
  onUnauthenticated(() => void hostRejected().catch(() => undefined));
};

/**
 * Whether this dashboard runs inside the desktop app. There, pairing belongs to the app: a token
 * this dashboard made would have nowhere to go (the app holds the token in the keychain), and
 * would leave a stray device on the host. So a refused token is handed to the app instead of
 * showing the dashboard's own pairing screen.
 */
export const isInsideDesktopApp = (
  bridge: Partial<DesktopHostBridge> | undefined = desktopBridge(),
): boolean => Boolean(bridge?.getHostConfig && bridge.hostRejected);

/** Asks the app to settle a refused token: its status screen offers "Pair again". */
export const handBackToDesktopApp = async (
  bridge: Partial<DesktopHostBridge> | undefined = desktopBridge(),
): Promise<void> => {
  await bridge?.hostRejected?.();
};

const desktopBridge = (): Partial<DesktopHostBridge> | undefined =>
  (window as Window & { aopDesktop?: Partial<DesktopHostBridge> }).aopDesktop;
