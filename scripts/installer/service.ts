import { homedir } from "node:os";
import { join } from "node:path";
import { buildChannel, type ChannelConfig } from "@aop/common";

export type SpawnSyncFn = (command: string[]) => { exitCode: number | null };

/** What `aop stop` did about the service install.sh registers for this build's channel. */
export type ServiceStop =
  | { kind: "stopped"; service: string }
  | { kind: "failed"; service: string }
  /** No service of this channel is running: the host, if any, runs from `aop run --background`. */
  | { kind: "none" };

export interface ServiceStopInput {
  platform: string;
  spawnSync: SpawnSyncFn;
  /** Whose service to stop; AOP Nightly's is not stable's, and stopping one must leave the other. */
  channel?: ChannelConfig;
  home?: string;
}

/**
 * Stops this channel's launchd agent or systemd user unit when it is running. A service never
 * writes the PID file `aop stop` falls back to, and launchd's KeepAlive would start a killed host
 * again, so the service has to be stopped through its manager. Detached agent runs keep going
 * (KillMode=process under systemd; launchd leaves them alone too).
 */
export const stopRunningService = (input: ServiceStopInput): ServiceStop => {
  const channel = input.channel ?? buildChannel();
  if (input.platform === "linux") return stopSystemdUnit(input.spawnSync, channel);
  if (input.platform === "darwin") {
    return stopLaunchdAgent(input.spawnSync, channel, input.home ?? homedir());
  }
  return { kind: "none" };
};

const stopSystemdUnit = (spawnSync: SpawnSyncFn, channel: ChannelConfig): ServiceStop => {
  const service = `${channel.systemdUnit}.service`;
  if (spawnSync(["systemctl", "--user", "is-active", service]).exitCode !== 0) {
    return { kind: "none" };
  }
  const stopped = spawnSync(["systemctl", "--user", "stop", service]).exitCode === 0;
  return { kind: stopped ? "stopped" : "failed", service };
};

const stopLaunchdAgent = (
  spawnSync: SpawnSyncFn,
  channel: ChannelConfig,
  home: string,
): ServiceStop => {
  const service = channel.launchdLabel;
  if (spawnSync(["launchctl", "list", service]).exitCode !== 0) return { kind: "none" };
  // Unload without -w: the agent stays enabled, so it starts again at the next login.
  const plist = join(home, "Library", "LaunchAgents", `${service}.plist`);
  const stopped = spawnSync(["launchctl", "unload", plist]).exitCode === 0;
  return { kind: stopped ? "stopped" : "failed", service };
};
