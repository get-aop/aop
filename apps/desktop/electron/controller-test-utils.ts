import type { DesktopState, HostProcessState } from "../src/backend/types";
import type { HostClient } from "./connection/host-client";
import { createConnectionMonitor } from "./connection/monitor";
import { createManualScheduler, fakeHostClient, HOST } from "./connection/test-utils";
import {
  createDesktopController,
  type DesktopController,
  type ShellView,
  type WindowPort,
} from "./desktop-controller";
import {
  createConfigStore,
  DEFAULT_LOCAL_PORT,
  type DesktopConfig,
  defaultConfig,
} from "./host-config/config-store";
import { createFakeKeychain, createMemoryFile } from "./host-config/test-utils";
import { createTokenStore, type EncryptedTokens } from "./host-config/token-store";
import type { HostSupervisor } from "./host-mode/supervisor";
import type { WatchTarget } from "./notifications/project-watcher";

export const LOCAL = `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`;

export const createFakeWindow = () => {
  const calls: string[] = [];
  let shown: "dashboard" | "shell" | "none" = "none";
  const port: WindowPort = {
    showShell: async (view: ShellView) => {
      shown = "shell";
      calls.push(`shell:${view}`);
    },
    showDashboard: async (path) => {
      shown = "dashboard";
      calls.push(path ? `dashboard:${path}` : "dashboard");
    },
    current: () => shown,
    focus: () => void calls.push("focus"),
  };
  return { port, calls };
};

export const createFakeSupervisor = (
  outcome: HostProcessState = { status: "running", ownership: "spawned", version: "0.9.51" },
) => {
  const record = {
    starts: 0,
    stops: 0,
    current: { status: "stopped" } as HostProcessState,
    outcome,
  };
  const supervisor: HostSupervisor = {
    start: async () => {
      record.starts += 1;
      record.current = record.outcome;
      return record.outcome;
    },
    stop: async () => {
      record.stops += 1;
      record.current = { status: "stopped" };
    },
    state: () => record.current,
  };
  return { supervisor, record };
};

export interface SetupOptions {
  config?: Partial<DesktopConfig>;
  token?: string | null;
  client?: HostClient;
  supervisor?: ReturnType<typeof createFakeSupervisor> | null;
}

export const setup = async (options: SetupOptions = {}) => {
  const clock = createManualScheduler();
  const window = createFakeWindow();
  const keychain = createFakeKeychain().keychain;
  const tokens = createTokenStore(keychain, createMemoryFile<EncryptedTokens>({}));
  const config = createConfigStore(
    createMemoryFile<DesktopConfig>({ ...defaultConfig(), ...options.config }),
  );
  if (options.token !== null && options.config?.remoteUrl) {
    await tokens.save(options.config.remoteUrl, options.token ?? "aop_saved");
  }
  const client = options.client ?? fakeHostClient();
  const monitor = createConnectionMonitor({
    clientFor: () => client,
    schedule: clock.schedule,
    connectedIntervalMs: 15_000,
    retryIntervalMs: 4_000,
  });
  const watched: string[] = [];
  const watcherTargets: WatchTarget[] = [];
  const supervisor = options.supervisor === undefined ? createFakeSupervisor() : options.supervisor;
  const changes: DesktopState[] = [];
  const controller: DesktopController = createDesktopController({
    appVersion: "0.9.51",
    platform: "darwin",
    config,
    tokens,
    monitor,
    watcher: {
      start: (target) => {
        watched.push("start");
        watcherTargets.push(target);
      },
      stop: () => void watched.push("stop"),
    },
    supervisor: supervisor?.supervisor ?? null,
    clientFor: () => client,
    window: window.port,
    deviceName: () => "Marcelo's MacBook",
    onChange: (state) => changes.push(state),
  });
  return {
    controller,
    window,
    watched,
    watcherTargets,
    tokens,
    config,
    clock,
    supervisor,
    changes,
    monitor,
  };
};

export const remote = { mode: "remote", remoteUrl: HOST, deviceName: "Work laptop" } as const;
export const unreachable = fakeHostClient({
  health: async () => ({ status: "unreachable", message: "away", failure: "refused" }),
});
