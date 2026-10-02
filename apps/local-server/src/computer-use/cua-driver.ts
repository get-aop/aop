import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
import type { CuaCheck, CuaReason, CuaStatus } from "@aop/common";
import { buildSpawnEnv } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";
import { messageOf, runWithTimeout } from "../agent-cli/probe.ts";

/** Where the CUA Driver installer puts the app; its `cua-driver` link in ~/.local/bin points here. */
export const CUA_APP_BINARY = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

const PROBE_TIMEOUT_MS = 5_000;

export interface CuaProbeDeps {
  /** The `cua-driver` a thread would launch, or null when there is none. */
  locate: () => string | null;
  /** Runs argv and returns its exit code and output; rejects on timeout. */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>;
  platform: NodeJS.Platform;
  /** The host's name as its owner knows it. */
  hostName: () => Promise<string>;
  now: () => Date;
}

/**
 * Asks the host's CUA Driver whether it can serve a thread. Every command is read-only:
 * `permissions status` reads the daemon's grants and never raises a macOS prompt, and
 * `check-update` reads a cached answer from GitHub. Nothing here starts the app.
 */
export const probeCua = async (deps: CuaProbeDeps = defaultDeps): Promise<CuaStatus> => {
  const host = { name: await deps.hostName().catch(() => hostname()), platform: deps.platform };
  const base = { host, checkedAt: deps.now().toISOString() };
  const path = deps.locate();
  if (!path) {
    return {
      ...base,
      ...verdict("not-installed", "CUA Driver is not installed on this host."),
      path: null,
      version: null,
      latestVersion: null,
      checks: [check("installed", "Installed", true, false, "No `cua-driver` on the host.")],
    };
  }
  const [version, latestVersion] = await Promise.all([
    readVersion(deps, path),
    readLatestVersion(deps, path),
  ]);
  const checks = [
    check("installed", "Installed", true, true, path),
    check(
      "answers",
      "Answers",
      true,
      version.ok,
      version.ok ? `cua-driver ${version.value}` : version.error,
    ),
    ...(version.ok ? await grantChecks(deps, path) : []),
    updateCheck(version.ok ? version.value : null, latestVersion),
  ];
  return {
    ...base,
    ...judge(checks, version.ok ? version.value : null),
    path,
    version: version.ok ? version.value : null,
    latestVersion,
    checks,
  };
};

type Outcome = { ok: true; value: string } | { ok: false; error: string };

const readVersion = async (deps: CuaProbeDeps, path: string): Promise<Outcome> => {
  try {
    const result = await deps.run([path, "--version"], PROBE_TIMEOUT_MS);
    const version = result.exitCode === 0 ? parseVersion(result.output) : null;
    return version
      ? { ok: true, value: version }
      : { ok: false, error: "`cua-driver --version` printed no version." };
  } catch (error) {
    return { ok: false, error: `cua-driver did not answer: ${messageOf(error)}` };
  }
};

// Informational only: an offline host or a rate-limited GitHub must not make CUA "not ready".
const readLatestVersion = async (deps: CuaProbeDeps, path: string): Promise<string | null> => {
  try {
    const result = await deps.run([path, "check-update", "--json"], PROBE_TIMEOUT_MS);
    const latest = parseJson(result.output)?.latest_version;
    return typeof latest === "string" ? latest : null;
  } catch {
    return null;
  }
};

// The daemon holds the grants, so whether it runs and what it was granted come in one report.
// Off macOS there are no grants to ask for and `cua-driver mcp` owns its runtime.
const grantChecks = async (deps: CuaProbeDeps, path: string): Promise<CuaCheck[]> => {
  if (deps.platform !== "darwin") {
    return [check("running", "Running", false, null, "Not needed off macOS.")];
  }
  const report = await deps
    .run([path, "permissions", "status", "--json"], PROBE_TIMEOUT_MS)
    .then((result) => parseJson(result.output))
    .catch(() => null);
  if (!report) {
    return [check("running", "Running", true, false, "cua-driver printed no permission report.")];
  }
  if (report.daemon_running === false) {
    return [
      check(
        "running",
        "Running",
        true,
        false,
        "Its app is not running, so its macOS permissions cannot be read.",
      ),
    ];
  }
  return [
    check("running", "Running", true, true, "Its app is running."),
    grant("accessibility", "Accessibility", report.accessibility),
    grant("screen-recording", "Screen Recording", report.screen_recording),
    directCapture(report.direct_capture_status),
  ];
};

const grant = (id: CuaCheck["id"], label: string, value: unknown): CuaCheck =>
  check(
    id,
    label,
    true,
    value === true,
    value === true ? "Granted." : "Not granted to Cua Driver.",
  );

// Tahoe's direct capture consent can only be read by a probe that may raise a prompt, which the
// host never runs; `permissions grant` on the host does.
const directCapture = (status: unknown): CuaCheck =>
  status === "ready"
    ? check("direct-capture", "Direct capture", false, true, "Consent given.")
    : check(
        "direct-capture",
        "Direct capture",
        false,
        null,
        "Not checked: reading it could raise a prompt on the host.",
      );

const updateCheck = (version: string | null, latest: string | null): CuaCheck => {
  if (!version || !latest) {
    return check("up-to-date", "Up to date", false, null, "Could not ask for the latest release.");
  }
  const behind = compareVersions(version, latest) < 0;
  return check(
    "up-to-date",
    "Up to date",
    false,
    !behind,
    behind ? `${latest} is out.` : `${version} is the latest.`,
  );
};

/** The first required check that failed decides the reason. */
const judge = (
  checks: CuaCheck[],
  version: string | null,
): Pick<CuaStatus, "status" | "reason" | "detail"> => {
  const failed = (id: CuaCheck["id"]) => checks.some((c) => c.id === id && c.required && !c.ok);
  if (failed("answers")) {
    return verdict("no-answer", checks.find((c) => c.id === "answers")?.detail ?? "");
  }
  if (failed("running")) {
    return verdict(
      "not-running",
      `CUA Driver is installed but its app is not running. ${checks.find((c) => c.id === "running")?.detail ?? ""}`.trim(),
    );
  }
  const missing = checks.filter((c) => c.required && c.ok === false).map((c) => c.label);
  if (missing.length > 0) {
    return verdict(
      "missing-permissions",
      `CUA Driver lacks the macOS ${missing.join(" and ")} permission${missing.length > 1 ? "s" : ""}.`,
    );
  }
  return verdict("ready", `CUA Driver ${version ?? ""} is ready on this host.`.replace("  ", " "));
};

const verdict = (
  reason: CuaReason,
  detail: string,
): Pick<CuaStatus, "status" | "reason" | "detail"> => ({
  status: reason === "ready" ? "ready" : reason === "not-installed" ? "not-installed" : "not-ready",
  reason,
  detail,
});

const check = (
  id: CuaCheck["id"],
  label: string,
  required: boolean,
  ok: boolean | null,
  detail: string,
): CuaCheck => ({ id, label, required, ok, detail });

const parseVersion = (output: string): string | null =>
  output.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;

const compareVersions = (a: string, b: string): number => {
  const parts = (v: string) => v.split(/[-+]/)[0]?.split(".").map(Number) ?? [];
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

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

// The name in System Settings › General › Sharing, which is what a person calls the Mac; the
// network host name otherwise.
const readHostName = async (): Promise<string> => {
  if (process.platform !== "darwin") return hostname();
  const result = await runWithTimeout(["scutil", "--get", "ComputerName"], PROBE_TIMEOUT_MS);
  const name = result.output.trim();
  return result.exitCode === 0 && name ? name : hostname();
};

const defaultDeps: CuaProbeDeps = {
  locate: locateCuaDriver,
  run: (argv, timeoutMs) => runWithTimeout(argv, timeoutMs),
  platform: process.platform,
  hostName: readHostName,
  now: () => new Date(),
};
