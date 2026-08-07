import { existsSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  type WebContents,
} from "electron";
import packageInfo from "../../../package.json";
import {
  createDesktopRuntime,
  type DesktopRuntime,
  defaultDesktopRuntimeDependencies,
} from "./host/desktop-runtime";
import { createElectronHost } from "./host/electron-host";
import { currentPlatform } from "./host/platform";
import { loadExecHost } from "./host/wsl";
import { registerDesktopIpc } from "./ipc";
import { resolveDesktopPaths } from "./runtime-paths";
import { isAllowedNavigation, isSafeExternalUrl } from "./security";
import { buildWindowOptions } from "./window-options";

const APP_SCHEME = "app";
const APP_HOST = "aop";
const development = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let finishingQuit = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

app.whenReady().then(async () => {
  const paths = resolveDesktopPaths(app.getAppPath(), process.resourcesPath, development);
  await registerAppProtocol(paths.rendererRoot);
  denyRendererPermissions();
  mainWindow = createMainWindow(paths.preloadPath);
  const resourcePath = (name: string): string => join(paths.resourceRoot, name);
  runtime = createDesktopRuntime(
    defaultDesktopRuntimeDependencies(
      currentPlatform(),
      packageInfo.version,
      resourcePath,
      loadExecHost,
    ),
  );

  const host = createElectronHost({
    version: packageInfo.version,
    resourcePath,
    shell,
    window: mainWindow,
    quit: () => app.quit(),
    runtime,
  });
  registerDesktopIpc(ipcMain, host, development);
  await loadDesktopUi(mainWindow);
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (finishingQuit || !runtime) return;
  event.preventDefault();
  finishingQuit = true;
  void runtime.stop().finally(() => app.quit());
});

const createMainWindow = (preloadPath: string): BrowserWindow => {
  const window = new BrowserWindow(buildWindowOptions(preloadPath));
  window.once("ready-to-show", () => window.show());
  secureNavigation(window.webContents);
  return window;
};

const loadDesktopUi = async (window: BrowserWindow): Promise<void> => {
  const devUrl = process.env.AOP_DESKTOP_DEV_URL ?? "http://127.0.0.1:25170";
  await window.loadURL(development ? devUrl : `${APP_SCHEME}://${APP_HOST}/index.html`);
};

const registerAppProtocol = async (rendererRoot: string): Promise<void> => {
  await protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response("Not found", { status: 404 });
    const requestedPath = decodeURIComponent(url.pathname.replace(/^\//u, "")) || "index.html";
    const filePath = normalize(join(rendererRoot, requestedPath));
    if (relative(rendererRoot, filePath).startsWith("..") || !existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
};

const denyRendererPermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
};

const secureNavigation = (webContents: WebContents): void => {
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, development)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
};
