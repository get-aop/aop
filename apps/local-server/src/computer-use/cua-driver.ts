import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CuaStatus } from "@aop/common";
import { buildSpawnEnv } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";
import { messageOf, runWithTimeout } from "../agent-cli/probe.ts";

/** Where the CUA Driver installer puts the app; its `cua-driver` link in ~/.local/bin points here. */
export const CUA_APP_BINARY = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

const PROBE_TIMEOUT_MS = 5_000;

const INSTALL = '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"';
const START = "open -n -g -a CuaDriver --args serve";
const GRANT = "cua-driver permissions grant";

export interface CuaProbeDeps {
  /** The `cua-driver` a thread would launch, or null when there is none. */
  locate: () => string | null;
  /** Runs argv and returns its exit code and output; rejects on timeout. */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>;
  platform: NodeJS.Platform;
}

/**
 * Asks CUA Driver whether it can serve a thread. Both commands are read-only: `permissions
 * status` reads the daemon's grants and never raises a macOS permission prompt.
 */
export const probeCua = async (deps: CuaProbeDeps = defaultDeps): Promise<CuaStatus> => {
  const path = deps.locate();
  if (!path) {
    return status("not-installed", null, null, "CUA Driver is not installed on this host.", [
      INSTALL,
      START,
      GRANT,
    ]);
  }
  try {
    const version = parseVersion((await deps.run([path, "--version"], PROBE_TIMEOUT_MS)).output);
    // Only macOS asks the person for grants; elsewhere an installed driver is ready.
    if (deps.platform !== "darwin") return status("ready", path, version, readyDetail(version), []);
    const permissions = await deps.run([path, "permissions", "status", "--json"], PROBE_TIMEOUT_MS);
    return readPermissions(path, version, permissions.output);
  } catch (error) {
    return status("error", path, null, `cua-driver did not answer: ${messageOf(error)}`, [
      "cua-driver doctor",
    ]);
  }
};

const readPermissions = (path: string, version: string | null, output: string): CuaStatus => {
  const report = parseJson(output);
  if (!report) {
    return status("error", path, version, "cua-driver printed no permission report.", [
      "cua-driver doctor",
    ]);
  }
  if (report.daemon_running === false) {
    return status(
      "not-running",
      path,
      version,
      "CUA Driver is installed but its app is not running, so its macOS permissions cannot be checked. A thread still gets the tools: the app starts on first use.",
      [START],
    );
  }
  const missing = [
    report.accessibility === true ? null : "Accessibility",
    report.screen_recording === true ? null : "Screen Recording",
  ].filter((name): name is string => name !== null);
  if (missing.length === 0) return status("ready", path, version, readyDetail(version), []);
  return status(
    "missing-permissions",
    path,
    version,
    `CUA Driver lacks the macOS ${missing.join(" and ")} permission${missing.length > 1 ? "s" : ""}, so threads run without its tools.`,
    [
      GRANT,
      `Or in System Settings › Privacy & Security › ${missing.join(" and ")}, turn on Cua Driver`,
    ],
  );
};

const readyDetail = (version: string | null): string =>
  `CUA Driver${version ? ` ${version}` : ""} is installed and has its macOS permissions.`;

const status = (
  state: CuaStatus["state"],
  path: string | null,
  version: string | null,
  detail: string,
  fix: string[],
): CuaStatus => ({
  state,
  // Not running still serves a thread: `cua-driver mcp` starts the app.
  usable: state === "ready" || state === "not-running",
  path,
  version,
  detail,
  fix,
});

const parseVersion = (output: string): string | null =>
  output.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;

const parseJson = (output: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(output.trim());
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * The driver a run would launch: `AOP_CUA_DRIVER` when set (an isolated stack or a test points
 * it at another build), else `cua-driver` on the PATH runs are spawned with, else the app.
 */
const locateCuaDriver = (): string | null => {
  const override = process.env.AOP_CUA_DRIVER?.trim();
  if (override) return existsSync(override) ? override : null;
  const resolved = resolveRuntimeExecutable("cua-driver", buildSpawnEnv().PATH);
  if (isAbsolute(resolved)) return resolved;
  return process.platform === "darwin" && existsSync(CUA_APP_BINARY) ? CUA_APP_BINARY : null;
};

const defaultDeps: CuaProbeDeps = {
  locate: locateCuaDriver,
  run: (argv, timeoutMs) => runWithTimeout(argv, timeoutMs),
  platform: process.platform,
};
