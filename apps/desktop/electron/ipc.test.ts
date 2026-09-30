import { describe, expect, mock, test } from "bun:test";
import type { DesktopState } from "../src/backend/types";
import { IPC_CHANNELS } from "./channels";
import { type DesktopIpcHost, registerDesktopIpc } from "./ipc";

type Handler = (event: { senderUrl: string }, ...args: unknown[]) => Promise<unknown>;

const SHELL = "app://desktop/index.html";
const DASHBOARD = "app://aop/projects/prj_1";
const HOST_PAGE = "https://mac.tail1234.ts.net/";

const setup = (development = false) => {
  const handlers = new Map<string, Handler>();
  const host: DesktopIpcHost = {
    getState: mock(() => ({ appVersion: "1" }) as DesktopState),
    connectHost: mock(async () => ({ ok: true as const })),
    forgetHost: mock(async () => {}),
    startHostMode: mock(async () => {}),
    stopHostMode: mock(async () => {}),
    setServeOverTailscale: mock(async () => {}),
    createPairingCode: mock(async () => ({ ok: true as const, code: "K7QM-4XNP", expiresAt: "x" })),
    openDashboard: mock(async () => {}),
    reconnect: mock(async () => {}),
    openLogsFolder: mock(async () => {}),
    quitApp: mock(async () => {}),
    getHostConfig: mock(async () => ({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_t" })),
    hostRejected: mock(async () => {}),
    setZoom: mock(async () => {}),
  };
  registerDesktopIpc(
    {
      handle: (channel, handler) => void handlers.set(channel, handler as Handler),
      removeHandler: (channel) => void handlers.delete(channel),
    },
    host,
    development,
  );
  const call = (channel: string, senderUrl: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler({ senderUrl }, ...args);
  };
  return { host, call, handlers };
};

/** Resolves to a marker when the call went through, whatever the operation itself returned. */
const allowed = (call: Promise<unknown>): Promise<string> => call.then(() => "allowed");

const SHELL_CHANNELS = [
  IPC_CHANNELS.getState,
  IPC_CHANNELS.connectHost,
  IPC_CHANNELS.forgetHost,
  IPC_CHANNELS.startHostMode,
  IPC_CHANNELS.stopHostMode,
  IPC_CHANNELS.setServeOverTailscale,
  IPC_CHANNELS.createPairingCode,
  IPC_CHANNELS.openDashboard,
  IPC_CHANNELS.reconnect,
  IPC_CHANNELS.openLogsFolder,
  IPC_CHANNELS.quitApp,
];

const validArgs = (channel: string): unknown[] => {
  if (channel === IPC_CHANNELS.connectHost) {
    return [{ url: "https://mac.tail1234.ts.net", code: "K7QM-4XNP", deviceName: "Work laptop" }];
  }
  return channel === IPC_CHANNELS.setServeOverTailscale ? [true] : [];
};

describe("who may change which host the app talks to", () => {
  test.each(SHELL_CHANNELS)("%s answers the connect screen", async (channel) => {
    const { call } = setup();

    await expect(allowed(call(channel, SHELL, ...validArgs(channel)))).resolves.toBe("allowed");
  });

  test.each(SHELL_CHANNELS)(
    "%s refuses the dashboard and a page a host served",
    async (channel) => {
      const { call, host } = setup();

      for (const sender of [DASHBOARD, HOST_PAGE, "", "app://other/"]) {
        await expect(call(channel, sender, ...validArgs(channel))).rejects.toThrow(
          "Blocked desktop IPC sender.",
        );
      }
      expect(host.connectHost).not.toHaveBeenCalled();
      expect(host.startHostMode).not.toHaveBeenCalled();
    },
  );

  test("the dev server counts as the connect screen only while developing", async () => {
    const dev = setup(true);
    const packaged = setup(false);

    await expect(allowed(dev.call(IPC_CHANNELS.getState, "http://127.0.0.1:25170/"))).resolves.toBe(
      "allowed",
    );
    await expect(packaged.call(IPC_CHANNELS.getState, "http://127.0.0.1:25170/")).rejects.toThrow();
  });
});

describe("what the dashboard may ask", () => {
  test("which host to use, and the token for it", async () => {
    const { call } = setup();

    await expect(call(IPC_CHANNELS.getHostConfig, DASHBOARD)).resolves.toEqual({
      baseUrl: "https://mac.tail1234.ts.net",
      token: "aop_t",
    });
  });

  test("never to anything a host served, or the connect screen, which has no use for it", async () => {
    const { call } = setup();

    for (const channel of [IPC_CHANNELS.getHostConfig, IPC_CHANNELS.hostRejected]) {
      for (const sender of [HOST_PAGE, SHELL, ""]) {
        await expect(call(channel, sender)).rejects.toThrow("Blocked desktop IPC sender.");
      }
    }
  });

  test("can report a refused token", async () => {
    const { call, host } = setup();

    await call(IPC_CHANNELS.hostRejected, DASHBOARD);

    expect(host.hostRejected).toHaveBeenCalledTimes(1);
  });

  test("cannot reach any of the connect screen's channels", async () => {
    const { call } = setup();

    await expect(call(IPC_CHANNELS.connectHost, DASHBOARD, {})).rejects.toThrow();
    await expect(call(IPC_CHANNELS.forgetHost, DASHBOARD)).rejects.toThrow();
  });
});

describe("what a page may send", () => {
  test("rejects malformed connect input before the app sees it", async () => {
    const { call, host } = setup();

    for (const bad of [
      null,
      "text",
      {},
      { url: 1, code: "x", deviceName: "y" },
      { url: "x", code: "x".repeat(301), deviceName: "y" },
    ]) {
      await expect(call(IPC_CHANNELS.connectHost, SHELL, bad)).rejects.toThrow(/Invalid/);
    }
    expect(host.connectHost).not.toHaveBeenCalled();
  });

  test("passes valid connect input through, as three strings and nothing else", async () => {
    const { call, host } = setup();

    await call(IPC_CHANNELS.connectHost, SHELL, {
      url: "mac.tail1234.ts.net",
      code: "K7QM-4XNP",
      deviceName: "Work laptop",
      extra: "ignored",
    });

    expect(host.connectHost).toHaveBeenCalledWith({
      url: "mac.tail1234.ts.net",
      code: "K7QM-4XNP",
      deviceName: "Work laptop",
    });
  });

  test("insists the Tailscale toggle is a boolean", async () => {
    const { call, host } = setup();

    await expect(call(IPC_CHANNELS.setServeOverTailscale, SHELL, "yes")).rejects.toThrow("Invalid");
    await call(IPC_CHANNELS.setServeOverTailscale, SHELL, false);

    expect(host.setServeOverTailscale).toHaveBeenCalledWith(false);
  });
});

describe("zoom", () => {
  test("is allowed from the dashboard and the connect screen within its limits", async () => {
    const { call, host } = setup();

    await call(IPC_CHANNELS.setZoom, DASHBOARD, 1.2);
    await call(IPC_CHANNELS.setZoom, SHELL, 0.7);

    expect(host.setZoom).toHaveBeenCalledTimes(2);
    for (const bad of [0.5, 2, Number.NaN, "1", null]) {
      await expect(call(IPC_CHANNELS.setZoom, DASHBOARD, bad)).rejects.toThrow(
        "Invalid zoom factor.",
      );
    }
  });

  test("is refused to a page a host served", async () => {
    const { call } = setup();

    await expect(call(IPC_CHANNELS.setZoom, HOST_PAGE, 1)).rejects.toThrow(
      "Blocked desktop IPC sender.",
    );
  });
});
