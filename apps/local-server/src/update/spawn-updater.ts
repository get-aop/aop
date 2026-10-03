import { closeSync, mkdirSync, openSync } from "node:fs";
import { aopPaths } from "@aop/infra";
import type { InstallLayout } from "./install-layout.ts";
import { detectRestartPlan } from "./restart.ts";
import { systemPlanInput } from "./system.ts";
import { updateLogPath } from "./update-log.ts";

/**
 * Starts `aop update` in a process that survives the restart it performs. The host cannot do
 * the update itself: restarting it ends the process that would be checking the result. Launchd
 * leaves a process in its own session alone. A systemd unit stops everything in its control
 * group, so there the run goes into a transient unit of its own; without `systemd-run` it
 * starts like any other and the new host is then judged only by the service's own restarts.
 */
export const startUpdaterProcess = async (
  layout: InstallLayout,
  hostEnv: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const env = updaterEnv(hostEnv);
  const logPath = updateLogPath();
  mkdirSync(aopPaths.logs(), { recursive: true });
  const plan = await detectRestartPlan({ ...systemPlanInput(env), layout });
  if (plan.kind === "systemd" && Bun.which("systemd-run")) {
    const proc = Bun.spawn(systemdRunCommand(layout, env, logPath), {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    if ((await proc.exited) === 0) return;
  }
  const log = openSync(logPath, "a");
  try {
    const proc = Bun.spawn([layout.binaryPath, "update"], {
      env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    proc.unref();
  } finally {
    closeSync(log);
  }
};

const systemdRunCommand = (
  layout: InstallLayout,
  env: NodeJS.ProcessEnv,
  logPath: string,
): string[] => [
  "systemd-run",
  "--user",
  "--collect",
  "--quiet",
  `--property=StandardOutput=append:${logPath}`,
  `--property=StandardError=append:${logPath}`,
  // A transient unit starts from the user manager's environment, not this process's.
  ...Object.entries(env)
    .filter(([key, value]) => value !== undefined && (key.startsWith("AOP_") || key === "PATH"))
    .map(([key, value]) => `--setenv=${key}=${value}`),
  "--",
  layout.binaryPath,
  "update",
];

// A host started from an agent's shell (a test stack) inherits the turn's session id; the update
// run is the host's own, not the agent's, and `aop update` refuses one (run-update.ts).
export const updaterEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { AOP_CHAT_SESSION_ID: _session, ...rest } = env;
  return rest;
};
