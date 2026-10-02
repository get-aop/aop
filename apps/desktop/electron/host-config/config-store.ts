import { buildChannel } from "@aop/common";
import type { HostChoice } from "../../src/backend/types";
import type { JsonFile } from "./json-file";

/** The port this app's channel runs its host on: 25150, or 25650 for AOP Nightly. */
export const DEFAULT_LOCAL_PORT = buildChannel().hostPort;

/** The app's settings that are not secret. The device token is kept apart, in the keychain. */
export interface DesktopConfig {
  mode: HostChoice | null;
  remoteUrl: string | null;
  deviceName: string | null;
  localPort: number;
  serveOverTailscale: boolean;
}

export interface ConfigStore {
  load: () => Promise<DesktopConfig>;
  /** Merges `patch` over what is saved and returns the result. */
  update: (patch: Partial<DesktopConfig>) => Promise<DesktopConfig>;
}

/**
 * `overrides` win over what is saved and are never written back: a development run that names
 * its own port must not leave that port in the config a released app then reads.
 */
export const createConfigStore = (
  file: JsonFile<DesktopConfig>,
  overrides: Partial<DesktopConfig> = {},
): ConfigStore => ({
  load: async () => ({ ...(await file.read()), ...overrides }),
  update: async (patch) => {
    const saved = { ...(await file.read()), ...patch };
    await file.write(saved);
    return { ...saved, ...overrides };
  },
});

export const defaultConfig = (): DesktopConfig => ({
  mode: null,
  remoteUrl: null,
  deviceName: null,
  localPort: DEFAULT_LOCAL_PORT,
  serveOverTailscale: false,
});

/** Reads a saved config field by field, so one bad field does not throw away the rest. */
export const parseConfig = (raw: unknown): DesktopConfig => {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const defaults = defaultConfig();
  const mode = value.mode === "remote" || value.mode === "local" ? value.mode : null;
  return {
    mode,
    remoteUrl: nonEmptyString(value.remoteUrl),
    deviceName: nonEmptyString(value.deviceName),
    localPort: isPort(value.localPort) ? value.localPort : defaults.localPort,
    serveOverTailscale: value.serveOverTailscale === true,
  };
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;
