import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostPort } from "./host-port.ts";
import { waitForHostVersion, waitUntilHostDown } from "./host-probe.ts";
import { detectPlatform, type InstallLayout } from "./install-layout.ts";
import { apiFetch, downloadFetch, feedConfigFromEnv, messageOf } from "./release-feed.ts";
import type { PlanInput, RestartTools } from "./restart.ts";
import type { StageTools } from "./stage.ts";
import type { UpdateDeps } from "./update-host.ts";

const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;

/** The real machine behind an update: the network, the file system, the service manager. */
export const createSystemUpdateDeps = (
  layout: InstallLayout,
  currentVersion: string,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): UpdateDeps => {
  const platform = detectPlatform();
  if (!platform)
    throw new Error(`No AOP host is published for ${process.platform}-${process.arch}`);
  const port = hostPort(env);
  return {
    layout,
    platform,
    currentVersion,
    feed: feedConfigFromEnv(env),
    fetch: apiFetch,
    stageTools: stageTools(log),
    restartTools: restartTools(port, env),
    planInput: systemPlanInput(env),
    waitForVersion: (version) => waitForHostVersion(port, version, START_TIMEOUT_MS),
    log,
  };
};

/** What tells the restart how this host is kept running: the service files and `server.pid`. */
export const systemPlanInput = (
  env: NodeJS.ProcessEnv = process.env,
): Omit<PlanInput, "layout"> => ({
  home: homedir(),
  os: process.platform,
  pidFile: join(homedir(), ".aop", "server.pid"),
  port: hostPort(env),
  runsBinary,
});

const stageTools = (log: (line: string) => void): StageTools => ({
  fetch: downloadFetch,
  extract: async (archive, into) => {
    await mkdir(into, { recursive: true });
    const exitCode = await runCommand(["tar", "-xzf", archive, "-C", into]);
    if (exitCode !== 0)
      throw new Error(`tar could not unpack the runtime assets (exit ${exitCode})`);
  },
  signBinary: async (path) => {
    // The same ad-hoc signature install.sh gives the binary, so launchd can restart it.
    if (process.platform !== "darwin") return;
    const exitCode = await runCommand(["codesign", "--force", "--sign", "-", path]).catch(() => -1);
    if (exitCode !== 0) log("Could not sign the new host; macOS may refuse to start it");
  },
  probeVersion: async (binary) => {
    const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), 10_000);
    try {
      const printed = (await new Response(proc.stdout).text()).trim();
      if ((await proc.exited) !== 0) throw new Error("it exited with an error for --version");
      return printed;
    } catch (error) {
      throw new Error(messageOf(error));
    } finally {
      clearTimeout(timer);
    }
  },
});

const restartTools = (port: number, env: NodeJS.ProcessEnv): RestartTools => ({
  run: (command) => runCommand(command, env),
  kill: (pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone, which is what was wanted.
    }
  },
  waitUntilDown: () => waitUntilHostDown(port, STOP_TIMEOUT_MS),
});

const runCommand = async (
  command: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> => {
  const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore", env });
  return proc.exited;
};

export const runsBinary = (pid: number, binaryPath: string): boolean => {
  const result = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 && result.stdout.toString().trim().startsWith(binaryPath);
};
