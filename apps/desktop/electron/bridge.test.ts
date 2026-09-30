import { describe, expect, mock, test } from "bun:test";
import { createDesktopBridge } from "./bridge";
import { IPC_CHANNELS } from "./channels";

const setup = () => {
  const invoke = mock(async (_channel: string, ..._args: unknown[]) => "answer" as unknown);
  const listeners = new Map<string, (payload: unknown) => void>();
  const unsubscribed: string[] = [];
  const bridge = createDesktopBridge(invoke, (channel, listener) => {
    listeners.set(channel, listener);
    return () => void unsubscribed.push(channel);
  });
  return { bridge, invoke, listeners, unsubscribed };
};

describe("createDesktopBridge", () => {
  test("turns each method into one call on its channel", async () => {
    const { bridge, invoke } = setup();

    await bridge.getState();
    await bridge.connectHost({ url: "u", code: "c", deviceName: "d" });
    await bridge.forgetHost();
    await bridge.startHostMode();
    await bridge.stopHostMode();
    await bridge.setServeOverTailscale(true);
    await bridge.createPairingCode();
    await bridge.openDashboard();
    await bridge.reconnect();
    await bridge.openLogsFolder();
    await bridge.quitApp();
    await bridge.getHostConfig();
    await bridge.hostRejected();
    await bridge.setZoom(1.1);
    await bridge.getUpdateState();
    await bridge.openUpdateDownload();
    await bridge.restartToUpdate();

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.getState],
      [IPC_CHANNELS.connectHost, { url: "u", code: "c", deviceName: "d" }],
      [IPC_CHANNELS.forgetHost],
      [IPC_CHANNELS.startHostMode],
      [IPC_CHANNELS.stopHostMode],
      [IPC_CHANNELS.setServeOverTailscale, true],
      [IPC_CHANNELS.createPairingCode],
      [IPC_CHANNELS.openDashboard],
      [IPC_CHANNELS.reconnect],
      [IPC_CHANNELS.openLogsFolder],
      [IPC_CHANNELS.quitApp],
      [IPC_CHANNELS.getHostConfig],
      [IPC_CHANNELS.hostRejected],
      [IPC_CHANNELS.setZoom, 1.1],
      [IPC_CHANNELS.getUpdateState],
      [IPC_CHANNELS.openUpdateDownload],
      [IPC_CHANNELS.restartToUpdate],
    ]);
  });

  test("gives a page the changes the app pushes, and a way to stop listening", () => {
    const { bridge, listeners, unsubscribed } = setup();
    const seen: unknown[] = [];

    const stop = bridge.onStateChanged((state) => seen.push(state));
    listeners.get(IPC_CHANNELS.stateChanged)?.({ mode: "remote" });
    stop();

    expect(seen).toEqual([{ mode: "remote" }]);
    expect(unsubscribed).toEqual([IPC_CHANNELS.stateChanged]);
  });

  test("uses distinct channels, so one page's call cannot be mistaken for another's", () => {
    const channels = Object.values(IPC_CHANNELS);

    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.every((channel) => channel.startsWith("desktop:"))).toBe(true);
  });
});
