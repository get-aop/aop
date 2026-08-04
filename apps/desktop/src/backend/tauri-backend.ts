import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { DesktopSetupState } from "../setup/types";
import type { DesktopBackend, SidecarState, WslDistro } from "./types";

export type TauriInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const createTauriBackend = (invoke: TauriInvoker = tauriInvoke): DesktopBackend => ({
  getSetupState: () => invoke<DesktopSetupState>("get_setup_state"),
  runSetupAction: (actionId) => invoke<DesktopSetupState>("run_setup_action", { actionId }),
  openSetupGuide: (actionId) => invoke<void>("open_setup_guide", { actionId }),
  startAopSidecar: () => invoke<SidecarState>("start_aop_sidecar"),
  getSidecarState: () => invoke<SidecarState>("get_sidecar_state"),
  openLogsFolder: () => invoke<void>("open_logs_folder"),
  quitApp: () => invoke<void>("quit_desktop_app"),
  listWslDistros: () => invoke<WslDistro[]>("list_wsl_distros"),
  getExecHost: () => invoke<string>("get_exec_host"),
  setExecHost: (mode) => invoke<void>("set_exec_host", { mode }),
});

export const tauriBackend = createTauriBackend();
