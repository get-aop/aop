import { CUA_DRIVER_VERSION, type CuaCheck, type CuaFix } from "@aop/common";
import type { ComputerUseConfig } from "../config.ts";
import { DEFAULT_VIRTUAL_DISPLAY, displayRunning } from "./display.ts";
import { inspectLinux } from "./linux-packages.ts";
import type { SetupSystem } from "./system.ts";

/**
 * What the host has for computer use beyond the driver itself, read without changing anything:
 * on Linux the screen, the system packages and the browser; everywhere the command that fixes
 * what is missing. The readiness check (cua-driver.ts) and `aop computer-use status` both show it.
 */
export interface HostInspection {
  checks: CuaCheck[];
  fix: CuaFix;
  /** Linux only: no X display is up for the driver, which makes it not ready. */
  noDisplay: boolean;
}

export interface InspectOptions {
  config: ComputerUseConfig;
  /** The host's own setup command (`aop` or `aop-nightly`). */
  setupCommand: string;
  /** Whether the driver is missing or behind the pin, so setup has work to do. */
  driverNeedsSetup: boolean;
}

export const inspectHost = async (
  sys: SetupSystem,
  options: InspectOptions,
): Promise<HostInspection> => {
  if (sys.platform !== "linux") {
    return {
      checks: [],
      fix: fix(options.driverNeedsSetup ? options.setupCommand : null, null, []),
      noDisplay: false,
    };
  }
  const display = options.config.display ?? sys.env.DISPLAY ?? null;
  const virtual = options.config.screen !== "desktop";
  const running = display !== null && displayRunning(sys, display);
  const linux = await inspectLinux(sys, { virtualDisplay: virtual });
  const required = linux.missing.filter((item) => !item.optional);
  const checks: CuaCheck[] = [
    displayCheck(display, running),
    {
      id: "system-packages",
      label: "System packages",
      required: false,
      ok: required.length === 0,
      detail:
        linux.missing.length === 0
          ? "Everything computer use needs is installed."
          : `Missing: ${linux.missing.map((item) => item.label).join(", ")}.`,
    },
    {
      id: "browser",
      label: "Browser",
      required: false,
      ok: linux.browser !== null,
      detail: linux.browser
        ? `${linux.browser} (browser tools work).`
        : "No browser CUA Driver accepts (a root-owned Google Chrome, Chromium or Edge; not the chromium snap): browser tools will not work, desktop tools will.",
    },
  ];
  const needsSetup = options.driverNeedsSetup || !running;
  return {
    checks,
    fix: fix(
      needsSetup ? options.setupCommand : null,
      linux.sudoCommand,
      linux.missing.map((item) => item.label),
    ),
    noDisplay: !running,
  };
};

const displayCheck = (display: string | null, running: boolean): CuaCheck => ({
  id: "display",
  label: "Screen",
  required: true,
  ok: running,
  detail: !display
    ? `No X display is configured: setup makes a virtual one (${DEFAULT_VIRTUAL_DISPLAY}).`
    : running
      ? `X display ${display} is up.`
      : `X display ${display} is not running.`,
});

const fix = (command: string | null, sudoCommand: string | null, missing: string[]): CuaFix => ({
  command,
  sudoCommand,
  missing,
  pinnedVersion: CUA_DRIVER_VERSION,
});
