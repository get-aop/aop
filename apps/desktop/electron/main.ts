import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildChannel } from "@aop/common";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  type WebContents,
} from "electron";
import packageInfo from "../../../package.json";
import { windowTitle } from "../src/backend/connection-label";
import type { AppUpdateState, DesktopState } from "../src/backend/types";
import { hostDriftTag, updateLabel } from "../src/backend/update-label";
import { APP_SCHEME, createAppProtocolHandler, DASHBOARD_HOST, SHELL_HOST } from "./app-protocol";
import { IPC_CHANNELS } from "./channels";
import { buildMenuTemplate } from "./chrome";
import { createHostClient, type FetchLike } from "./connection/host-client";
import { createConnectionMonitor } from "./connection/monitor";
import { createDesktopController, type ShellView, type WindowPort } from "./desktop-controller";
import { createConfigStore, defaultConfig, parseConfig } from "./host-config/config-store";
import { createJsonFile } from "./host-config/json-file";
import { createSafeStorageKeychain } from "./host-config/keychain";
import {
  createTokenStore,
  type EncryptedTokens,
  parseEncryptedTokens,
} from "./host-config/token-store";
import {
  buildHostLaunch,
  createHealthWaiter,
  createPortProbe,
  resolveHostExecutable,
  resolveLogDir,
  spawnHostServer,
} from "./host-mode/launch";
import { createHostSupervisor } from "./host-mode/supervisor";
import { registerDesktopIpc } from "./ipc";
import { createLogger, type Logger } from "./log";
import { createNotifier } from "./notifications/notifier";
import { createProjectWatcher } from "./notifications/project-watcher";
import { resolveDesktopPaths } from "./runtime-paths";
import { isAllowedNavigation, isSafeExternalUrl, isSafeUpdateUrl } from "./security";
import { type AppUpdater, createAppUpdater } from "./updates/app-updater";
import { createElectronUpdaterPort } from "./updates/electron-updater-port";
import { appBundleOf, isDeveloperIdSigned } from "./updates/mac-signature";
import { chooseUpdateMode } from "./updates/update-policy";
import { buildWindowOptions } from "./window-options";

// Development means the connect screen comes from the Vite dev server named in AOP_DESKTOP_DEV_URL.
// An unpackaged app without one runs the built screen, exactly as a packaged app does.
const DEV_SHELL_URL = process.env.AOP_DESKTOP_DEV_URL ?? "";
const development = !app.isPackaged && DEV_SHELL_URL !== "";

// The scheme must be declared before the app is ready. `secure` makes the pages a secure
// context; `supportFetchAPI` lets them fetch their own files.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// A packaged app's version is the one Electron Builder wrote into it: a nightly build carries
// `0.10.7-nightly.<date>.<run>`, not the release in package.json. A development run has none.
const appVersion = app.isPackaged ? app.getVersion() : packageInfo.version;

// `AOP_RELEASE_FEED_URL` points the app at a fake release feed; it is how the updater is tested.
const feedOverride = process.env.AOP_RELEASE_FEED_URL?.trim() || undefined;

let mainWindow: BrowserWindow | null = null;
let finishingQuit = false;

if (!app.requestSingleInstanceLock()) {
  // Two copies would fight over the keychain entry and the host's port.
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  // Windows attributes notifications to this id; a packaged NSIS install uses the same one.
  app.setAppUserModelId(buildChannel().appId);
  const paths = resolveDesktopPaths(app.getAppPath(), process.resourcesPath, development);
  const userData = app.getPath("userData");
  const logDir = resolveLogDir(process.env);
  const log = createLogger(
    join(logDir, "desktop.log"),
    development || process.env.AOP_DESKTOP_LOG_STDOUT === "1",
  );
  logChrome = log;
  const fetchImpl: FetchLike = (input, init) => net.fetch(input, init);
  const clientFor = (hostUrl: string) => createHostClient(hostUrl, fetchImpl);

  const portOverride = portFromEnv(process.env.AOP_DESKTOP_LOCAL_SERVER_PORT);
  const config = createConfigStore(
    createJsonFile(join(userData, "desktop-config.json"), parseConfig, defaultConfig),
    portOverride === null ? {} : { localPort: portOverride },
  );
  const localPort = (await config.load()).localPort;
  const tokens = createTokenStore(
    createSafeStorageKeychain(safeStorage),
    createJsonFile<EncryptedTokens>(
      join(userData, "device-tokens.json"),
      parseEncryptedTokens,
      () => ({}),
    ),
  );

  const notifier = createNotifier({
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
    open: (target) => void controller.openTarget(target),
  });
  const watcher = createProjectWatcher({
    fetch: fetchImpl,
    notify: (intent) => {
      log("notification", { kind: intent.kind, title: intent.title, body: intent.body });
      notifier.notify(intent);
    },
    isAppFocused: () => process.env.AOP_DESKTOP_NOTIFY_WHEN_FOCUSED !== "1" && windowIsInFront(),
    now: Date.now,
    schedule: timer,
    log,
  });
  const monitor = createConnectionMonitor({ clientFor, schedule: timer });

  const executable =
    process.platform === "darwin"
      ? resolveHostExecutable(process.env, paths.resourceRoot, existsSync)
      : null;
  const localClient = createHostClient(`http://127.0.0.1:${localPort}`, fetchImpl, 1_500);
  const supervisor = executable
    ? createHostSupervisor({
        port: localPort,
        probe: createPortProbe(localClient),
        waitHealthy: createHealthWaiter(localClient, sleep),
        spawn: () =>
          spawnHostServer(
            buildHostLaunch({ executable, port: localPort, logDir, baseEnv: process.env }),
          ),
        now: Date.now,
        schedule: timer,
        sleep,
        onChange: () => controller.refresh(),
        log,
      })
    : null;

  const controller = createDesktopController({
    appVersion,
    platform:
      process.platform === "win32" ? "win32" : process.platform === "linux" ? "linux" : "darwin",
    config,
    tokens,
    monitor,
    watcher,
    supervisor,
    clientFor,
    window: windowPort(),
    deviceName: () => hostname().replace(/\.local$/, ""),
    onChange: applyChrome,
    log,
  });

  const updateMode = chooseUpdateMode({
    platform: process.platform,
    packaged: app.isPackaged,
    disabled: process.env.AOP_DESKTOP_DISABLE_UPDATES === "1",
    // Only a packaged app is asked: the Electron binary a development run starts is signed by
    // the Electron project, not by us.
    macSigned:
      process.platform === "darwin" &&
      app.isPackaged &&
      (await isDeveloperIdSigned(appBundleOf(app.getPath("exe")))),
  });
  appUpdater = createAppUpdater({
    mode: updateMode,
    appVersion,
    arch: process.arch,
    feedOrigin: feedOverride,
    fetch: fetchImpl,
    createAutoUpdater: createElectronUpdaterPort,
    schedule: timer,
    onChange: applyUpdate,
    log,
  });

  await registerAppProtocol(paths, controller.activeHostUrl);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  mainWindow = createMainWindow(paths.preloadPath, log);
  registerDesktopIpc(
    ipcMain,
    {
      getState: controller.state,
      connectHost: controller.connectHost,
      forgetHost: controller.forgetHost,
      startHostMode: controller.startHostMode,
      stopHostMode: controller.stopHostMode,
      setServeOverTailscale: controller.setServeOverTailscale,
      createPairingCode: controller.createPairingCode,
      openDashboard: controller.openDashboard,
      reconnect: controller.reconnect,
      openLogsFolder: async () => {
        await mkdir(logDir, { recursive: true });
        const error = await shell.openPath(logDir);
        if (error) throw new Error(error);
      },
      quitApp: async () => app.quit(),
      getHostConfig: controller.hostConfigForDashboard,
      hostRejected: controller.hostRejected,
      setZoom: async (factor) => void mainWindow?.webContents.setZoomFactor(factor),
      getUpdateState: () => updateState,
      openUpdateDownload: openDownload,
      restartToUpdate: async () => appUpdater?.restartToUpdate(),
    },
    development,
  );

  installMenuActions(controller);
  installLifecycle(controller);
  log("started", {
    version: appVersion,
    channel: buildChannel().id,
    development,
    hostMode: supervisor !== null,
    updates: updateMode,
  });
  await controller.boot();
  appUpdater.start();
}

// The menu's actions need the controller, which exists only once the app has started.
let menuActions: Parameters<typeof buildMenuTemplate>[1] | null = null;
let lastState: DesktopState | null = null;
let appUpdater: AppUpdater | null = null;
let updateState: AppUpdateState = { status: "idle" };
let logChrome: Logger = () => {};

function installMenuActions(controller: ReturnType<typeof createDesktopController>): void {
  menuActions = {
    showDashboard: () => void controller.openDashboard(),
    reconnect: () => void controller.reconnect(),
    changeHost: () => void controller.showChangeHost(),
    manageHost: () => void controller.showHostMode(),
    startHost: () => void controller.startHostMode(),
    stopHost: () => void controller.stopHostMode(),
    openUpdateDownload: () => void openDownload(),
    restartToUpdate: () => appUpdater?.restartToUpdate(),
  };
  if (lastState) applyChrome(lastState);
}

function installLifecycle(controller: ReturnType<typeof createDesktopController>): void {
  // A Mac app stays alive without a window: the host it runs keeps serving, and notifications keep coming.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    mainWindow = createMainWindow(
      resolveDesktopPaths(app.getAppPath(), process.resourcesPath, development).preloadPath,
    );
    void controller.reopen();
  });
  app.on("before-quit", (event) => {
    if (finishingQuit) return;
    event.preventDefault();
    finishingQuit = true;
    appUpdater?.stop();
    void controller.shutdown().finally(() => app.quit());
  });
}

function applyChrome(state: DesktopState): void {
  lastState = state;
  const title = titleFor(state);
  logChrome("window title", { title });
  mainWindow?.setTitle(title);
  mainWindow?.webContents.send(IPC_CHANNELS.stateChanged, state);
  if (!menuActions) return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(
        {
          platform: process.platform,
          connection: state.connection,
          hostProcess: state.hostProcess,
          hostModeAvailable: state.hostModeAvailable,
          update: updateState,
          appVersion: state.appVersion,
        },
        menuActions,
      ),
    ),
  );
}

// The update and a host on another release are asides in the title: quiet, and always in view.
function titleFor(state: DesktopState): string {
  const { connection } = state;
  return windowTitle(connection, [
    updateLabel(updateState),
    connection.status === "connected"
      ? hostDriftTag(connection.hostVersion, state.appVersion)
      : null,
  ]);
}

async function openDownload(): Promise<void> {
  const url = appUpdater?.downloadUrl();
  if (url && isSafeUpdateUrl(url, feedOverride !== undefined)) await shell.openExternal(url);
}

function applyUpdate(next: AppUpdateState): void {
  updateState = next;
  mainWindow?.webContents.send(IPC_CHANNELS.updateStateChanged, next);
  if (lastState) applyChrome(lastState);
}

function windowPort(): WindowPort {
  return {
    showShell: async (view: ShellView) => {
      await load(
        `${development ? DEV_SHELL_URL : `${APP_SCHEME}://${SHELL_HOST}/index.html`}#/${view}`,
      );
    },
    showDashboard: async (path) => {
      const window = mainWindow;
      if (!window) return;
      if (path && currentSurface() === "dashboard") {
        await window.webContents.executeJavaScript(navigateInPageScript(path));
      } else {
        await load(`${APP_SCHEME}://${DASHBOARD_HOST}${path ?? "/"}`);
      }
    },
    current: currentSurface,
    focus: focusWindow,
  };
}

// A page that a newer navigation replaced ends with ERR_ABORTED (-3). That is not a failure to report.
async function load(url: string): Promise<void> {
  try {
    await mainWindow?.loadURL(url);
  } catch (error) {
    if ((error as { errno?: number }).errno !== -3) throw error;
  }
}

// The dashboard's router listens for popstate, so a notification opens a thread without a reload.
const navigateInPageScript = (path: string): string =>
  `(() => { const path = ${JSON.stringify(path)}; if (window.location.pathname !== path) window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); })()`;

function currentSurface(): "dashboard" | "shell" | "none" {
  const url = mainWindow?.webContents.getURL() ?? "";
  if (url.startsWith(`${APP_SCHEME}://${DASHBOARD_HOST}`)) return "dashboard";
  if (
    url.startsWith(`${APP_SCHEME}://${SHELL_HOST}`) ||
    (development && url.startsWith(DEV_SHELL_URL))
  )
    return "shell";
  return "none";
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const windowIsInFront = (): boolean =>
  Boolean(mainWindow?.isFocused() && mainWindow.isVisible() && !mainWindow.isMinimized());

function createMainWindow(preloadPath: string, log?: Logger): BrowserWindow {
  const window = new BrowserWindow(buildWindowOptions(preloadPath));
  window.once("ready-to-show", () => window.show());
  // The page's own <title> would replace the one that says how the app stands with its host.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  if (lastState) window.setTitle(titleFor(lastState));
  window.webContents.on("did-finish-load", () =>
    log?.("page loaded", { url: window.webContents.getURL(), title: window.getTitle() }),
  );
  secureNavigation(window.webContents);
  return window;
}

async function registerAppProtocol(
  paths: ReturnType<typeof resolveDesktopPaths>,
  hostOrigin: () => string | null,
): Promise<void> {
  protocol.handle(
    APP_SCHEME,
    createAppProtocolHandler({
      roots: { shellRoot: paths.shellRoot, dashboardRoot: paths.dashboardRoot },
      fileExists: existsSync,
      serveFile: (path) => net.fetch(pathToFileURL(path).toString()),
      hostOrigin,
    }),
  );
}

function secureNavigation(webContents: WebContents): void {
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, development)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

// Development runs a second app beside a released one, on its own port.
function portFromEnv(value: string | undefined): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

const timer = (run: () => void, delayMs: number): (() => void) => {
  const handle = setTimeout(run, delayMs);
  return () => clearTimeout(handle);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
