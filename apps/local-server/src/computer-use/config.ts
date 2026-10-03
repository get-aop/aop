import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, buildSpawnEnv } from "@aop/infra";

/**
 * What `aop computer-use setup` chose for this host, kept in `<AOP home>/computer-use.json`:
 * which X display threads drive on Linux (the virtual one setup made, or the person's desktop).
 * The host reads it on every use, so a setup run takes effect without a host restart. Without the
 * file, the host's own `DISPLAY` decides, as before setup existed.
 */
export interface ComputerUseConfig {
  display?: string;
  /** `virtual`: an Xvfb display setup runs as a user service. `desktop`: the person's own session. */
  screen?: "virtual" | "desktop";
}

export const CONFIG_FILE = "computer-use.json";

export const computerUseConfigPath = (home: string = aopPaths.home()): string =>
  join(home, CONFIG_FILE);

export const readComputerUseConfig = (
  path: string = computerUseConfigPath(),
): ComputerUseConfig => {
  try {
    return parseComputerUseConfig(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
};

/** The config in a file's text; anything unreadable counts as no choice made. */
export const parseComputerUseConfig = (text: string | null): ComputerUseConfig => {
  try {
    const value: unknown = JSON.parse(text ?? "");
    if (!value || typeof value !== "object") return {};
    const { display, screen } = value as Record<string, unknown>;
    return {
      ...(typeof display === "string" && display.trim() ? { display: display.trim() } : {}),
      ...(screen === "virtual" || screen === "desktop" ? { screen } : {}),
    };
  } catch {
    return {};
  }
};

/** The X display CUA Driver drives and the live view captures; undefined when there is none. */
export const computerUseDisplay = (): string | undefined =>
  readComputerUseConfig().display ?? buildSpawnEnv().DISPLAY;

/** The environment of a `cua-driver` process the host starts. */
export const driverEnv = (): Record<string, string | undefined> => {
  const env = buildSpawnEnv();
  const display = computerUseDisplay();
  return display ? { ...env, DISPLAY: display } : env;
};
