import { describe, expect, mock, test } from "bun:test";
import { createDesktopBridge } from "./bridge";
import { IPC_CHANNELS } from "./channels";

describe("Electron preload bridge", () => {
  test("exposes narrow methods on fixed IPC channels", async () => {
    const invoke = mock(async (_channel: string, ..._args: unknown[]) => undefined);
    const bridge = createDesktopBridge(invoke);

    await bridge.getSetupState();
    await bridge.runSetupAction("install-runtime-codex");
    await bridge.openSetupGuide("install-runtime-codex");
    await bridge.startAopSidecar();
    await bridge.getSidecarState();
    await bridge.openLogsFolder();
    await bridge.quitApp();
    await bridge.listWslDistros();
    await bridge.getExecHost();
    await bridge.setExecHost("wsl:Ubuntu");
    await bridge.setZoom(1.2);

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.getSetupState);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.runSetupAction, "install-runtime-codex");
    expect(invoke).toHaveBeenNthCalledWith(10, IPC_CHANNELS.setExecHost, "wsl:Ubuntu");
    expect(invoke).toHaveBeenNthCalledWith(11, IPC_CHANNELS.setZoom, 1.2);
  });
});
