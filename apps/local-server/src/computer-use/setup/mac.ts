import { CUA_COMMANDS } from "@aop/common";
import { findDriver } from "./driver-install.ts";
import type { SetupIO } from "./run-setup.ts";
import type { SetupSystem } from "./system.ts";

/**
 * The macOS part of setup: Cua Driver's app must run (it holds the permissions) and have
 * Accessibility and Screen Recording. `permissions status` is read-only and never raises a
 * prompt; `permissions grant` opens the dialogs, so setup runs it only from a terminal, after
 * asking, never on its own. The person clicks Allow at the Mac.
 */
export const setupMac = async (sys: SetupSystem, io: SetupIO): Promise<void> => {
  const driver = await findDriver(sys);
  if (!driver) return;
  let report = await permissions(sys, driver.path);
  if (report?.daemon_running === false || report === null) {
    await sys.run(["open", "-n", "-g", "-a", "CuaDriver", "--args", "serve"]);
    await sleep(2_000);
    report = await permissions(sys, driver.path);
  }
  if (report?.daemon_running === false || report === null) {
    io.print(`✗ Cua Driver's app is not running. Start it with: ${CUA_COMMANDS.start}`);
    return;
  }
  io.print("✓ Cua Driver's app is running");
  const missing = [
    report.accessibility === true ? null : "Accessibility",
    report.screen_recording === true ? null : "Screen Recording",
  ].filter((name): name is string => name !== null);
  if (missing.length === 0) {
    io.print("✓ Accessibility and Screen Recording are granted");
    return;
  }
  io.print(`Cua Driver still needs ${missing.join(" and ")} (granted to the Cua Driver app).`);
  const grant =
    io.interactive &&
    (await io.confirm("Open the macOS permission dialogs now? You click Allow in each.", true));
  if (grant) {
    await sys.run([driver.path, "permissions", "grant"], { interactive: true });
    return;
  }
  io.print(`At the Mac, run: ${CUA_COMMANDS.grant}`);
  io.print(
    "Or turn on Cua Driver in System Settings › Privacy & Security › Accessibility and › Screen & System Audio Recording.",
  );
};

interface PermissionReport {
  daemon_running?: boolean;
  accessibility?: boolean;
  screen_recording?: boolean;
}

const permissions = async (sys: SetupSystem, path: string): Promise<PermissionReport | null> => {
  const result = await sys.run([path, "permissions", "status", "--json"], { timeoutMs: 10_000 });
  try {
    const value: unknown = JSON.parse(result.output.trim());
    return value && typeof value === "object" ? (value as PermissionReport) : null;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
