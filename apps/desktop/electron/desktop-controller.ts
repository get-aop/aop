import type {
  ConnectInput,
  ConnectionState,
  ConnectResult,
  DesktopState,
  PairingCodeResult,
} from "../src/backend/types";
import { type ConnectDeps, connectToHost, forgetHost } from "./connection/connect-host";
import type { HostClient } from "./connection/host-client";
import type { ConnectionMonitor, WatchedHost } from "./connection/monitor";
import { type ConfigStore, type DesktopConfig, defaultConfig } from "./host-config/config-store";
import type { TokenStore } from "./host-config/token-store";
import { tailscaleHint } from "./host-mode/launch";
import type { HostSupervisor } from "./host-mode/supervisor";
import { type NotificationTarget, notificationPath } from "./notifications/policy";
import type { ProjectWatcher } from "./notifications/project-watcher";

export type ShellView = "connect" | "host" | "status";

/** The one window, as the controller sees it. */
export interface WindowPort {
  showShell: (view: ShellView) => Promise<void>;
  /** Shows the bundled dashboard, at `path` when given. */
  showDashboard: (path?: string) => Promise<void>;
  current: () => "dashboard" | "shell" | "none";
  focus: () => void;
}

export interface ControllerDeps {
  appVersion: string;
  platform: DesktopState["platform"];
  config: ConfigStore;
  tokens: TokenStore;
  monitor: ConnectionMonitor;
  watcher: ProjectWatcher;
  /** Null where the app cannot run a host: Windows, and a build that ships no server. */
  supervisor: HostSupervisor | null;
  clientFor: (hostUrl: string) => HostClient;
  window: WindowPort;
  deviceName: () => string;
  /** Called after every change to what the screens, the title and the menu show. */
  onChange: (state: DesktopState) => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface HostConfigForDashboard {
  baseUrl: string;
  token: string | null;
}

export interface DesktopController {
  /** Loads what was saved and opens the right first screen. */
  boot: () => Promise<void>;
  state: () => DesktopState;
  connectHost: (input: ConnectInput) => Promise<ConnectResult>;
  forgetHost: () => Promise<void>;
  startHostMode: () => Promise<void>;
  stopHostMode: () => Promise<void>;
  setServeOverTailscale: (enabled: boolean) => Promise<void>;
  createPairingCode: () => Promise<PairingCodeResult>;
  openDashboard: () => Promise<void>;
  reconnect: () => Promise<void>;
  showChangeHost: () => Promise<void>;
  showHostMode: () => Promise<void>;
  /** The host the bundled dashboard should talk to, and the token for it. */
  hostConfigForDashboard: () => Promise<HostConfigForDashboard>;
  /** The dashboard reports that the host refused its token. */
  hostRejected: () => Promise<void>;
  /** The person clicked a notification. */
  openTarget: (target: NotificationTarget) => Promise<void>;
  /** The window was closed and the app is still running: put the right page back. */
  reopen: () => Promise<void>;
  /** The origin of the host the dashboard is talking to, for the dashboard's content security policy. */
  activeHostUrl: () => string | null;
  /** The host process changed state, or something else the screens show did. */
  refresh: () => void;
  shutdown: () => Promise<void>;
}

/**
 * Everything the app decides, in one place and apart from Electron: which host it is a client
 * of, when it talks to it, what the window shows as the connection changes, and when the host on
 * this Mac runs. Electron reaches it through the ports in `ControllerDeps`, so each rule is
 * tested here with fakes.
 */
export const createDesktopController = (deps: ControllerDeps): DesktopController => {
  let config: DesktopConfig = defaultConfig();
  let shellView: ShellView | null = null;
  let active: WatchedHost | null = null;
  let watching = false;

  const localUrl = (): string => `http://127.0.0.1:${config.localPort}`;
  const connectDeps: ConnectDeps = {
    tokens: deps.tokens,
    config: deps.config,
    clientFor: deps.clientFor,
  };

  const state = (): DesktopState => ({
    appVersion: deps.appVersion,
    platform: deps.platform,
    mode: config.mode,
    remoteUrl: config.remoteUrl,
    connection: deps.monitor.state(),
    hostProcess: deps.supervisor?.state() ?? { status: "stopped" },
    hostModeAvailable: deps.supervisor !== null,
    localPort: config.localPort,
    serveOverTailscale: config.serveOverTailscale,
    tailscale: tailscaleHint(config.localPort),
    defaultDeviceName: config.deviceName ?? deps.deviceName(),
  });

  const refresh = (): void => deps.onChange(state());

  const showShell = async (view: ShellView): Promise<void> => {
    shellView = view;
    await deps.window.showShell(view);
  };

  const showDashboard = async (path?: string): Promise<void> => {
    shellView = null;
    await deps.window.showDashboard(path);
  };

  /** Who the app should be talking to right now, or null when it has no host or no token for it. */
  const resolveTarget = async (): Promise<WatchedHost | null> => {
    if (config.mode === "local") return { host: localUrl(), token: null };
    if (config.mode !== "remote" || !config.remoteUrl) return null;
    const token = await deps.tokens.load(config.remoteUrl);
    return token === null ? null : { host: config.remoteUrl, token };
  };

  /** The page to show when there is no dashboard to show: the host on this Mac, or how the remote one is. */
  const screenWithoutDashboard = (): ShellView => {
    if (config.mode === "local") return "host";
    return config.mode === "remote" ? "status" : "connect";
  };

  const stopWatching = (): void => {
    deps.watcher.stop();
    watching = false;
  };

  /** Points the connection monitor at the current host, and returns how the first look went. */
  const applyTarget = async (): Promise<ConnectionState> => {
    stopWatching();
    active = await resolveTarget();
    return deps.monitor.watch(active);
  };

  // Notifications run only against a host that answered and knows this device.
  const followNotifications = (connection: ConnectionState): void => {
    if (connection.status === "connected" && active && !watching) {
      deps.watcher.start({ baseUrl: active.host, token: active.token });
      watching = true;
    } else if (
      (connection.status === "unauthorized" ||
        connection.status === "incompatible" ||
        connection.status === "unconfigured") &&
      watching
    ) {
      stopWatching();
    }
  };

  // A host that turned this device away needs the person, wherever they are in the app; a host
  // that is merely slow does not, and the dashboard has its own way of showing that.
  const followWindow = async (connection: ConnectionState): Promise<void> => {
    const shown = deps.window.current();
    if (connection.status === "connected" && shown === "shell" && shellView === "status") {
      await showDashboard();
    } else if (
      shown === "dashboard" &&
      (connection.status === "unauthorized" || connection.status === "incompatible")
    ) {
      await showShell("status");
    }
  };

  deps.monitor.subscribe((connection) => {
    deps.log?.("connection", { connection });
    refresh();
    followNotifications(connection);
    followWindow(connection).catch((error) =>
      deps.log?.("could not update the window", { error: String(error) }),
    );
  });

  const bootRemote = async (): Promise<void> => {
    const first = await applyTarget();
    // A saved host with no token in the keychain (a new login, a restored profile) is paired again.
    if (active === null) return showShell("connect");
    if (first.status === "connected") await showDashboard();
    else await showShell("status");
  };

  const bootLocal = async (): Promise<void> => {
    const host = await deps.supervisor?.start();
    if (host?.status !== "running") return showShell("host");
    const first = await applyTarget();
    if (first.status === "connected") await showDashboard();
    else await showShell("host");
  };

  const boot = async (): Promise<void> => {
    config = await deps.config.load();
    refresh();
    if (config.mode === "local" && deps.supervisor) await bootLocal();
    else if (config.mode === "remote") await bootRemote();
    else await showShell("connect");
  };

  const connectHost = async (input: ConnectInput): Promise<ConnectResult> => {
    try {
      const result = await connectToHost(connectDeps, input);
      if (!result.ok) return result;
      config = await deps.config.load();
      // One host at a time: connecting elsewhere ends the host this app was running.
      await deps.supervisor?.stop();
      await applyTarget();
      await showDashboard();
      return result;
    } catch (error) {
      deps.log?.("connect failed", { error: String(error) });
      return { ok: false, code: "failed", message: "Something went wrong while connecting." };
    }
  };

  const disconnect = async (): Promise<void> => {
    stopWatching();
    active = null;
    await deps.monitor.watch(null);
    await forgetHost(connectDeps);
    config = await deps.config.load();
    await showShell("connect");
    refresh();
  };

  const startHostMode = async (): Promise<void> => {
    if (!deps.supervisor) throw new Error("This build cannot run a host.");
    stopWatching();
    await deps.monitor.watch(null);
    config = await deps.config.update({ mode: "local" });
    await showShell("host");
    const host = await deps.supervisor.start();
    if (host.status === "running") await applyTarget();
    refresh();
  };

  const stopHostMode = async (): Promise<void> => {
    stopWatching();
    await deps.monitor.watch(null);
    await deps.supervisor?.stop();
    refresh();
  };

  const createPairingCode = async (): Promise<PairingCodeResult> => {
    if (config.mode !== "local") {
      return { ok: false, message: "Only the Mac that runs the host can make a pairing code." };
    }
    const result = await deps.clientFor(localUrl()).createPairingCode();
    if (result.status === "ok") return { ok: true, code: result.code, expiresAt: result.expiresAt };
    return {
      ok: false,
      message:
        result.status === "not-owner"
          ? "The host would not give a code to this app. Is it running on this Mac?"
          : result.message,
    };
  };

  const hostRejected = async (): Promise<void> => {
    const now = await deps.monitor.check();
    if (now.status !== "connected" && deps.window.current() === "dashboard") {
      await showShell("status");
    }
  };

  return {
    boot,
    state,
    connectHost,
    forgetHost: disconnect,
    startHostMode,
    stopHostMode,
    setServeOverTailscale: async (enabled) => {
      config = await deps.config.update({ serveOverTailscale: enabled });
      refresh();
    },
    createPairingCode,
    openDashboard: () => showDashboard(),
    reconnect: async () => {
      if (active === null) await applyTarget();
      else await deps.monitor.check();
    },
    showChangeHost: () => showShell("connect"),
    showHostMode: () => showShell("host"),
    hostConfigForDashboard: async () => {
      const target = active ?? (await resolveTarget());
      if (!target) throw new Error("No host is set up.");
      return { baseUrl: target.host, token: target.token };
    },
    hostRejected,
    reopen: async () => {
      if (deps.monitor.state().status === "connected") await showDashboard();
      else await showShell(screenWithoutDashboard());
    },
    activeHostUrl: () => active?.host ?? null,
    openTarget: async (target) => {
      deps.window.focus();
      await showDashboard(notificationPath(target));
    },
    refresh,
    shutdown: async () => {
      stopWatching();
      await deps.monitor.watch(null);
      await deps.supervisor?.stop();
    },
  };
};
