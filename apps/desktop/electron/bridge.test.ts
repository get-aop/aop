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
    await bridge.getAppInfo();
    await bridge.getUpdateState();
    await bridge.checkForUpdates();
    await bridge.downloadAndRestart();
    await bridge.openUpdateDownload();
    await bridge.restartToUpdate();
    await bridge.setAutoDownload(false);

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
      [IPC_CHANNELS.getAppInfo],
      [IPC_CHANNELS.getUpdateState],
      [IPC_CHANNELS.checkForUpdates],
      [IPC_CHANNELS.downloadAndRestart],
      [IPC_CHANNELS.openUpdateDownload],
      [IPC_CHANNELS.restartToUpdate],
      [IPC_CHANNELS.setAutoDownload, false],
    ]);
  });

  test("gives the dashboard its browser: four channels, its payloads as objects", async () => {
    const { bridge, invoke, listeners } = setup();
    const events: unknown[] = [];

    bridge.browser.onEvent((event) => events.push(event));
    listeners.get(IPC_CHANNELS.browserEvent)?.({ kind: "prompt-closed", id: "p1" });
    await bridge.browser.setActive(true);
    await bridge.browser.answerPrompt("p1", false);
    await bridge.browser.downloadAction("d1", "reveal");

    expect(events).toEqual([{ kind: "prompt-closed", id: "p1" }]);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.browserSetActive, true],
      [IPC_CHANNELS.browserAnswerPrompt, { id: "p1", allow: false }],
      [IPC_CHANNELS.browserDownloadAction, { id: "d1", action: "reveal" }],
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

  test("holds the app menu's Settings… until the dashboard listens, then hands it over once", () => {
    const { bridge, listeners } = setup();
    const opened: string[] = [];

    // The menu loaded the dashboard and told it before its app had started.
    listeners.get(IPC_CHANNELS.openSettings)?.(undefined);
    const stop = bridge.onOpenSettings(() => opened.push("first"));
    expect(opened).toEqual(["first"]);

    listeners.get(IPC_CHANNELS.openSettings)?.(undefined);
    expect(opened).toEqual(["first", "first"]);

    stop();
    bridge.onOpenSettings(() => opened.push("second"));
    expect(opened).toEqual(["first", "first"]);
  });

  test("holds Check for Updates… and Host Setup… the same way, each on its own channel", () => {
    const { bridge, listeners } = setup();
    const opened: string[] = [];

    listeners.get(IPC_CHANNELS.openUpdates)?.(undefined);
    listeners.get(IPC_CHANNELS.openHostSetup)?.(undefined);
    bridge.onOpenUpdates(() => opened.push("updates"));
    expect(opened).toEqual(["updates"]);

    bridge.onOpenHostSetup(() => opened.push("host setup"));
    expect(opened).toEqual(["updates", "host setup"]);
    listeners.get(IPC_CHANNELS.openUpdates)?.(undefined);
    expect(opened).toEqual(["updates", "host setup", "updates"]);
  });

  test("uses distinct channels, so one page's call cannot be mistaken for another's", () => {
    const channels = Object.values(IPC_CHANNELS);

    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.every((channel) => channel.startsWith("desktop:"))).toBe(true);
  });
});
