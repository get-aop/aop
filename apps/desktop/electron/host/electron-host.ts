import { mkdir } from "node:fs/promises";
import type { BrowserWindow, Shell } from "electron";
import type { DesktopIpcHost } from "../ipc";
import { getSystemSetupState, runSystemSetupAction } from "./commands";
import {
  createDesktopRuntime,
  type DesktopRuntime,
  defaultDesktopRuntimeDependencies,
  defaultLogDirFor,
} from "./desktop-runtime";
import { setupGuideUrl } from "./installers";
import { currentPlatform } from "./platform";
import {
  formatExecHost,
  listDesktopWslDistros,
  listWslDistros,
  loadExecHost,
  parseExecHost,
  saveExecHost,
} from "./wsl";

interface ElectronHostOptions {
  version: string;
  resourcePath: (name: string) => string;
  shell: Pick<Shell, "openExternal" | "openPath">;
  window: BrowserWindow;
  quit: () => void;
  runtime?: DesktopRuntime;
}

export const createElectronHost = (options: ElectronHostOptions): DesktopIpcHost => {
  const platform = currentPlatform();
  const runtime =
    options.runtime ??
    createDesktopRuntime(
      defaultDesktopRuntimeDependencies(
        platform,
        options.version,
        options.resourcePath,
        loadExecHost,
      ),
    );

  return {
    getSetupState: getSystemSetupState,
    runSetupAction: runSystemSetupAction,
    openSetupGuide: async (actionId) => {
      await options.shell.openExternal(setupGuideUrl(actionId));
    },
    startAopSidecar: runtime.start,
    getSidecarState: async () => runtime.getState(),
    openLogsFolder: async () => {
      const logDir = defaultLogDirFor(platform, process.env);
      await mkdir(logDir, { recursive: true });
      const error = await options.shell.openPath(logDir);
      if (error) throw new Error(error);
    },
    quitApp: async () => {
      await runtime.stop();
      options.quit();
    },
    listWslDistros: () => listDesktopWslDistros(platform),
    getExecHost: async () => formatExecHost(await loadExecHost()),
    setExecHost: async (rawMode) => {
      const mode = parseExecHost(rawMode);
      if (platform === "windows" && mode.kind === "native") {
        throw new Error("AOP Desktop requires a WSL 2 distro on Windows.");
      }
      if (mode.kind === "wsl") {
        const distros = await listWslDistros();
        if (!distros.some((distro) => distro.name === mode.distro)) {
          throw new Error(`WSL distro '${mode.distro}' was not found.`);
        }
      }
      await saveExecHost(mode);
    },
    setZoom: async (factor) => {
      options.window.webContents.setZoomFactor(factor);
    },
  };
};
