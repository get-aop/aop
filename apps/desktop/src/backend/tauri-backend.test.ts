import { describe, expect, mock, test } from "bun:test";
import type { DesktopSetupState } from "../setup/types";
import { createTauriBackend, type TauriInvoker } from "./tauri-backend";
import type { SidecarState } from "./types";

describe("createTauriBackend", () => {
  test("maps desktop backend calls to Tauri commands", async () => {
    const setupState = healthyState();
    const sidecarState = readySidecar();
    const { invoke, invokeMock } = createMockInvoker(async (command) => {
      if (command === "get_setup_state") return setupState;
      return sidecarState;
    });
    const backend = createTauriBackend(invoke);

    await expect(backend.getSetupState()).resolves.toEqual(setupState);
    await expect(backend.startAopSidecar()).resolves.toEqual(sidecarState);
    await expect(backend.getSidecarState()).resolves.toEqual(sidecarState);
    await backend.openLogsFolder();
    await backend.quitApp();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_setup_state", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "start_aop_sidecar", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(3, "get_sidecar_state", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(4, "open_logs_folder", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(5, "quit_desktop_app", undefined);
  });

  test("passes approved setup action ids to the setup command", async () => {
    const setupState = healthyState();
    const { invoke, invokeMock } = createMockInvoker(async () => setupState);
    const backend = createTauriBackend(invoke);

    await expect(backend.runSetupAction("install-runtime-codex")).resolves.toEqual(setupState);

    expect(invokeMock).toHaveBeenCalledWith("run_setup_action", {
      actionId: "install-runtime-codex",
    });
  });

  test("opens setup guides through a dedicated host command", async () => {
    const { invoke, invokeMock } = createMockInvoker(async () => undefined);
    const backend = createTauriBackend(invoke);

    await backend.openSetupGuide("install-runtime-codex");

    expect(invokeMock).toHaveBeenCalledWith("open_setup_guide", {
      actionId: "install-runtime-codex",
    });
  });

  test("maps the WSL execution-host commands", async () => {
    const distros = [{ name: "Ubuntu", isDefault: true, running: true, version: 2 }];
    const { invoke, invokeMock } = createMockInvoker(async (command) => {
      if (command === "list_wsl_distros") return distros;
      if (command === "get_exec_host") return "wsl:Ubuntu";
      return undefined;
    });
    const backend = createTauriBackend(invoke);

    await expect(backend.listWslDistros()).resolves.toEqual(distros);
    await expect(backend.getExecHost()).resolves.toBe("wsl:Ubuntu");
    await backend.setExecHost("wsl:Ubuntu");

    expect(invokeMock).toHaveBeenCalledWith("list_wsl_distros", undefined);
    expect(invokeMock).toHaveBeenCalledWith("get_exec_host", undefined);
    expect(invokeMock).toHaveBeenCalledWith("set_exec_host", { mode: "wsl:Ubuntu" });
  });
});

const createMockInvoker = (
  implementation: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
): { invoke: TauriInvoker; invokeMock: ReturnType<typeof mock<typeof implementation>> } => {
  const invokeMock = mock(implementation);
  const invoke: TauriInvoker = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => invokeMock(command, args) as Promise<T>;

  return { invoke, invokeMock };
};

const healthyState = (): DesktopSetupState => ({
  ready: true,
  blockingRequirements: [],
  requirements: [],
  runtimes: [],
});

const readySidecar = (): SidecarState => ({
  status: "ready",
  dashboardUrl: "http://127.0.0.1:25150/",
});
