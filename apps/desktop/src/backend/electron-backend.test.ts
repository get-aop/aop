import { describe, expect, mock, test } from "bun:test";
import type { DesktopSetupState } from "../setup/types";
import { createElectronBackend, type ElectronDesktopBridge } from "./electron-backend";
import type { SidecarState } from "./types";

describe("createElectronBackend", () => {
  test("maps every backend operation to the narrow preload bridge", async () => {
    const setup = healthyState();
    const sidecar = readySidecar();
    const bridge = createBridge(setup, sidecar);
    const backend = createElectronBackend(bridge);

    await expect(backend.getSetupState()).resolves.toEqual(setup);
    await expect(backend.runSetupAction("install-runtime-codex")).resolves.toEqual(setup);
    await backend.openSetupGuide("install-runtime-codex");
    await expect(backend.startAopSidecar()).resolves.toEqual(sidecar);
    await expect(backend.getSidecarState()).resolves.toEqual(sidecar);
    await backend.openLogsFolder();
    await backend.quitApp();
    await expect(backend.listWslDistros()).resolves.toEqual([]);
    await expect(backend.getExecHost()).resolves.toBe("native");
    await backend.setExecHost("wsl:Ubuntu");

    expect(bridge.runSetupAction).toHaveBeenCalledWith("install-runtime-codex");
    expect(bridge.openSetupGuide).toHaveBeenCalledWith("install-runtime-codex");
    expect(bridge.setExecHost).toHaveBeenCalledWith("wsl:Ubuntu");
  });
});

const createBridge = (setup: DesktopSetupState, sidecar: SidecarState): ElectronDesktopBridge => ({
  getSetupState: mock(async () => setup),
  runSetupAction: mock(async () => setup),
  openSetupGuide: mock(async () => undefined),
  startAopSidecar: mock(async () => sidecar),
  getSidecarState: mock(async () => sidecar),
  openLogsFolder: mock(async () => undefined),
  quitApp: mock(async () => undefined),
  listWslDistros: mock(async () => []),
  getExecHost: mock(async () => "native"),
  setExecHost: mock(async () => undefined),
  setZoom: mock(async () => undefined),
});

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
