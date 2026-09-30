/**
 * What the desktop app's main process tells its screens, and what the screens may ask of it.
 * Both sides import this file, so a change to it is a change to the contract.
 */

/** Which host this app is a client of. `local` is this Mac running the host itself. */
export type HostChoice = "remote" | "local";

export type IncompatibleReason = "not-aop" | "client-too-old" | "host-too-old";

export type ConnectionState =
  | { status: "unconfigured" }
  | { status: "connecting"; host: string }
  | { status: "connected"; host: string; hostVersion: string }
  | { status: "unreachable"; host: string; message: string }
  /** The host does not accept this device's token: it was removed on the host, or never valid. */
  | { status: "unauthorized"; host: string }
  | {
      status: "incompatible";
      host: string;
      reason: IncompatibleReason;
      hostVersion: string | null;
    };

/** The host server this app runs on the Mac (host mode). */
export type HostProcessState =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running"; ownership: "spawned" | "adopted"; version: string }
  | { status: "restarting"; attempt: number }
  | { status: "stopping" }
  | { status: "failed"; message: string };

export interface TailscaleHint {
  /** Publishes the host on the tailnet over HTTPS. Shown, never run: the person runs it. */
  serveCommand: string;
  resetCommand: string;
}

export interface DesktopState {
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  /** The host this app is set up for; null before the first connection. */
  mode: HostChoice | null;
  /** The remote host's address, kept while another mode is active so the connect screen can offer it. */
  remoteUrl: string | null;
  connection: ConnectionState;
  hostProcess: HostProcessState;
  /** Whether this build can run the host server: the Mac app ships the server, Windows does not. */
  hostModeAvailable: boolean;
  localPort: number;
  serveOverTailscale: boolean;
  tailscale: TailscaleHint;
  defaultDeviceName: string;
}

export type ConnectErrorCode =
  | "invalid-url"
  | "unreachable"
  | "not-aop"
  | "client-too-old"
  | "host-too-old"
  | "wrong-code"
  | "rate-limited"
  | "keychain-unavailable"
  | "failed";

export type ConnectResult = { ok: true } | { ok: false; code: ConnectErrorCode; message: string };

export interface ConnectInput {
  url: string;
  code: string;
  deviceName: string;
}

/** A pairing code the host owner can hand to another device. Only the host's own Mac can make one. */
export type PairingCodeResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; message: string };

/**
 * The app's own update, as the screens and the menu show it. `available` is a notice with a
 * download link (the macOS app until it is signed); `downloading` and `ready` belong to the
 * automatic path (the Windows app), where `ready` waits for a restart.
 */
export type AppUpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; releaseUrl: string | null }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string };

/** What the connect, host and status screens call. Every method is one IPC round trip. */
export interface DesktopBackend {
  getState: () => Promise<DesktopState>;
  onStateChanged: (listener: (state: DesktopState) => void) => () => void;
  connectHost: (input: ConnectInput) => Promise<ConnectResult>;
  /** Forgets the remote host: revokes this device there when it can, and drops the token. */
  forgetHost: () => Promise<void>;
  startHostMode: () => Promise<void>;
  stopHostMode: () => Promise<void>;
  setServeOverTailscale: (enabled: boolean) => Promise<void>;
  createPairingCode: () => Promise<PairingCodeResult>;
  /** Shows the dashboard for the current host. */
  openDashboard: () => Promise<void>;
  reconnect: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  quitApp: () => Promise<void>;
  getUpdateState: () => Promise<AppUpdateState>;
  onUpdateStateChanged: (listener: (state: AppUpdateState) => void) => () => void;
  /** Opens the new version's download in the person's browser. */
  openUpdateDownload: () => Promise<void>;
  /** Installs a downloaded update and restarts the app. */
  restartToUpdate: () => Promise<void>;
}
