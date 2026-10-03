import { join } from "node:path";
import type { SetupSystem } from "./system.ts";

/**
 * CUA Driver itself, installed with CUA's own installer at the version AOP pins: on Linux into
 * `~/.cua-driver/packages` with `cua-driver` linked into `~/.local/bin`, on macOS as
 * /Applications/CuaDriver.app with the same link. No sudo either way. A driver newer than the pin
 * is left alone (the person updated it on purpose); an older one is upgraded.
 */
export const CUA_INSTALLER_URL = "https://cua.ai/driver/install.sh";
export const MAC_APP_BINARY = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

export interface InstalledDriver {
  path: string;
  version: string | null;
}

/** The driver the host would run: `AOP_CUA_DRIVER`, `cua-driver` on the PATH, `~/.local/bin`, the app. */
export const findDriver = async (sys: SetupSystem): Promise<InstalledDriver | null> => {
  const override = sys.env.AOP_CUA_DRIVER?.trim();
  const candidates = override
    ? [override]
    : [
        sys.which("cua-driver"),
        join(sys.home, ".local", "bin", "cua-driver"),
        ...(sys.platform === "darwin" ? [MAC_APP_BINARY] : []),
      ];
  const path = candidates.find((candidate): candidate is string =>
    Boolean(candidate && sys.exists(candidate)),
  );
  if (!path) return null;
  const result = await sys.run([path, "--version"], { timeoutMs: 10_000 });
  const version = result.exitCode === 0 ? parseVersion(result.output) : null;
  return { path, version };
};

/** What setup does about the driver: nothing, install it, or upgrade it to the pin. */
export const driverAction = (
  installed: InstalledDriver | null,
  pinned: string,
): "none" | "install" | "upgrade" | "repair" => {
  if (!installed) return "install";
  if (!installed.version) return "repair";
  return compareVersions(installed.version, pinned) < 0 ? "upgrade" : "none";
};

/**
 * Runs CUA's installer for the pinned version. Telemetry stays off on a fresh install: AOP turns
 * nothing on for the person. The PATH line in shell profiles is left alone; AOP finds the driver
 * in ~/.local/bin without it.
 */
export const installDriver = async (
  sys: SetupSystem,
  pinned: string,
  options: { interactive: boolean },
): Promise<{ ok: boolean; output: string }> => {
  const script = `set -e; curl -fsSL ${CUA_INSTALLER_URL} | bash -s -- --no-modify-path`;
  const result = await sys.run(["/bin/bash", "-c", script], {
    timeoutMs: 10 * 60_000,
    interactive: options.interactive,
    env: {
      CUA_DRIVER_RS_VERSION: pinned,
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      CUA_DRIVER_RS_NO_MODIFY_PATH: "1",
    },
  });
  return { ok: result.exitCode === 0, output: result.output };
};

export const parseVersion = (output: string): string | null =>
  output.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;

export const compareVersions = (a: string, b: string): number => {
  const parts = (v: string) => v.split(/[-+]/)[0]?.split(".").map(Number) ?? [];
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};
