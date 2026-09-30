import { describe, expect, mock, test } from "bun:test";
import type { SidecarState } from "../src/backend/types";
import { IPC_CHANNELS } from "./channels";
import { type DesktopIpcHost, registerDesktopIpc } from "./ipc";

describe("Electron desktop IPC", () => {
  test("rejects privileged calls from dashboard and external pages", async () => {
    const { ipc, handlers } = createIpcRegistry();
    registerDesktopIpc(ipc, createHost(), false);

    const handler = handlers.get(IPC_CHANNELS.getSetupState);
    await expect(handler?.(event("http://127.0.0.1:25150/"))).rejects.toThrow(
      "Blocked desktop IPC sender",
    );
    await expect(handler?.(event("https://attacker.example/"))).rejects.toThrow(
      "Blocked desktop IPC sender",
    );
  });

  test("allows setup calls from the packaged app", async () => {
    const { ipc, handlers } = createIpcRegistry();
    const host = createHost();
    registerDesktopIpc(ipc, host, false);

    await handlers.get(IPC_CHANNELS.runSetupAction)?.(
      event("app://aop/index.html"),
      "install-runtime-claude",
    );

    expect(host.runSetupAction).toHaveBeenCalledWith("install-runtime-claude");
  });

  test("allows dashboard zoom but validates its range", async () => {
    const { ipc, handlers } = createIpcRegistry();
    const host = createHost();
    registerDesktopIpc(ipc, host, false);

    await handlers.get(IPC_CHANNELS.setZoom)?.(event("http://127.0.0.1:25150/"), 1.2);
    await expect(
      handlers.get(IPC_CHANNELS.setZoom)?.(event("http://127.0.0.1:25150/"), 4),
    ).rejects.toThrow("Invalid zoom factor");

    expect(host.setZoom).toHaveBeenCalledWith(1.2);
  });
});

type Handler = (event: { senderUrl: string }, ...args: unknown[]) => Promise<unknown>;

const createIpcRegistry = () => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipc: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  };
};

const event = (senderUrl: string) => ({ senderUrl });

const createHost = (): DesktopIpcHost => ({
  getSetupState: mock(async () => setupState),
  runSetupAction: mock(async (_actionId: string) => setupState),
  openSetupGuide: mock(async (_actionId: string) => undefined),
  startAopSidecar: mock(async (): Promise<SidecarState> => ({ status: "ready" })),
  getSidecarState: mock(async (): Promise<SidecarState> => ({ status: "idle" })),
  openLogsFolder: mock(async () => undefined),
  quitApp: mock(async () => undefined),
  listWslDistros: mock(async () => []),
  getExecHost: mock(async () => "native"),
  setExecHost: mock(async (_mode: string) => undefined),
  setZoom: mock(async (_factor: number) => undefined),
});

const setupState = {
  ready: true,
  requirements: [],
  runtimes: [],
  blockingRequirements: [],
};
