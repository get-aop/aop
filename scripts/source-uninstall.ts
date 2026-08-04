#!/usr/bin/env bun

import { readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createTerminalProgress,
  silentTerminalProgress,
  type TerminalProgress,
} from "./terminal-progress";

export type SupportedPlatform = "darwin" | "linux";

type Command = string[];

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export type UninstallDependencies = {
  getProcessCwd: (pid: number, platform: SupportedPlatform) => Promise<string | null>;
  killProcess: (pid: number) => Promise<void>;
  listProcesses: () => Promise<RunningProcess[]>;
  removeDir: (path: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  run: (command: Command, options?: RunOptions) => Promise<void>;
};

type RunningProcess = {
  pid: number;
  command: string;
};

type UninstallOptions = {
  dependencies?: Partial<UninstallDependencies>;
  homeDir?: string;
  platform?: SupportedPlatform;
  progress?: TerminalProgress;
  workspaceDir?: string;
};

type UninstallerArgs = {
  mode: "help" | "uninstall";
};

const LAUNCHD_SERVICE_NAME = "com.aop.local-server";
const SYSTEMD_SERVICE_NAME = "aop-local-server";
const PROCESS_STOP_GRACE_MS = 2_000;
const PROCESS_FORCE_STOP_GRACE_MS = 1_000;
const PROCESS_STOP_POLL_MS = 100;
const UNINSTALL_USAGE = `Usage: ./uninstall

Removes the source-based local AOP setup for the current user:
- stops and removes the local-server user service
- unlinks the global aop CLI registration
- removes ~/.aop/logs
`;

export const parseUninstallerArgs = (args: string[]): UninstallerArgs => {
  if (args.length === 0) {
    return { mode: "uninstall" };
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { mode: "help" };
  }

  throw new Error(`Unknown argument "${args[0]}"`);
};

export const uninstallFromSource = async (options: UninstallOptions = {}): Promise<void> => {
  const platform = options.platform ?? detectPlatform();
  const workspaceDir = options.workspaceDir ?? resolve(import.meta.dirname, "..");
  const homeDir = options.homeDir ?? homedir();
  const dependencies = createDependencies(options.dependencies);
  const progress = options.progress ?? silentTerminalProgress;

  const logsDir = join(homeDir, ".aop", "logs");

  if (platform === "darwin") {
    await progress.runStep("Stopping local server", () =>
      uninstallLaunchAgent({ dependencies, homeDir }),
    );
  } else {
    await progress.runStep("Stopping local server", () =>
      uninstallSystemdUnit({ dependencies, homeDir }),
    );
  }

  await progress.runStep("Cleaning up AOP processes", () =>
    cleanupAopBunProcesses({
      dependencies,
      platform,
      workspaceDir,
    }),
  );
  await progress.runStep("Unlinking CLI globally", () =>
    dependencies.run(["bun", "unlink"], { cwd: workspaceDir, allowFailure: true }),
  );
  await progress.runStep("Removing logs", () => dependencies.removeDir(logsDir));
};

export const runSourceUninstall = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseUninstallerArgs(args);
  if (parsed.mode === "help") {
    process.stdout.write(UNINSTALL_USAGE);
    return;
  }

  const progress = createTerminalProgress();
  progress.banner("Uninstalling AOP…");

  await uninstallFromSource({ progress });
  process.stdout.write(
    "\nAOP source uninstall complete.\nThe local server user service has been removed and the global `aop` link was cleaned up.\n",
  );
};

const uninstallLaunchAgent = async ({
  dependencies,
  homeDir,
}: {
  dependencies: UninstallDependencies;
  homeDir: string;
}): Promise<void> => {
  const plistPath = join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_SERVICE_NAME}.plist`);
  await dependencies.run(["launchctl", "unload", plistPath], { allowFailure: true });
  await dependencies.removeFile(plistPath);
};

const uninstallSystemdUnit = async ({
  dependencies,
  homeDir,
}: {
  dependencies: UninstallDependencies;
  homeDir: string;
}): Promise<void> => {
  const unitPath = join(homeDir, ".config", "systemd", "user", `${SYSTEMD_SERVICE_NAME}.service`);
  await dependencies.run(
    ["systemctl", "--user", "disable", "--now", `${SYSTEMD_SERVICE_NAME}.service`],
    {
      allowFailure: true,
    },
  );
  await dependencies.removeFile(unitPath);
  await dependencies.run(["systemctl", "--user", "daemon-reload"], { allowFailure: true });
};

const createDependencies = (
  dependencies: Partial<UninstallDependencies> = {},
): UninstallDependencies => ({
  getProcessCwd: getProcessCwd,
  killProcess: killProcess,
  listProcesses: listProcesses,
  removeDir: removeDir,
  removeFile: removeFile,
  run: runCommand,
  ...dependencies,
});

const detectPlatform = (): SupportedPlatform => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(
    `Unsupported platform "${process.platform}". Source uninstall supports macOS and Linux.`,
  );
};

const removeDir = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true });
};

const removeFile = async (path: string): Promise<void> => {
  await rm(path, { force: true });
};

const cleanupAopBunProcesses = async ({
  dependencies,
  platform,
  workspaceDir,
}: {
  dependencies: UninstallDependencies;
  platform: SupportedPlatform;
  workspaceDir: string;
}): Promise<void> => {
  const processes = await dependencies.listProcesses();

  for (const processInfo of processes) {
    if (processInfo.pid === process.pid) {
      continue;
    }

    const cwd = await dependencies.getProcessCwd(processInfo.pid, platform);
    if (!isAopBunProcess(processInfo.command, cwd, workspaceDir)) {
      continue;
    }

    await dependencies.killProcess(processInfo.pid);
  }
};

const isAopBunProcess = (command: string, cwd: string | null, workspaceDir: string): boolean => {
  if (!/\bbun(?:\.exe)?\b/.test(command)) {
    return false;
  }

  return (
    command.includes(workspaceDir) ||
    isPathInWorkspace(cwd, workspaceDir) ||
    command.includes("apps/local-server/src/run.ts") ||
    command.includes("./scripts/dev.ts")
  );
};

const isPathInWorkspace = (path: string | null, workspaceDir: string): boolean => {
  if (path === null) {
    return false;
  }

  return path === workspaceDir || path.startsWith(`${workspaceDir}/`);
};

const listProcesses = async (): Promise<RunningProcess[]> => {
  const proc = Bun.spawn(["ps", "-eo", "pid=,args="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await readProcessOutput(proc.stdout);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to list running processes");
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return [];
      }

      const pid = match[1];
      const command = match[2];
      if (!pid || !command) {
        return [];
      }

      if (!command) {
        return [];
      }

      return [
        {
          pid: Number(pid),
          command,
        },
      ];
    });
};

const getProcessCwd = async (pid: number, platform: SupportedPlatform): Promise<string | null> => {
  if (platform === "linux") {
    try {
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }

  const proc = Bun.spawn(["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await readProcessOutput(proc.stdout);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return null;
  }

  const cwdLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("n"));
  return cwdLine ? cwdLine.slice(1) : null;
};

const readProcessOutput = (
  stream: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> =>
  stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve("");

const killProcess = async (pid: number): Promise<void> => {
  const termSent = signalProcess(pid, "SIGTERM");
  if (!termSent || (await waitForProcessExit(pid, PROCESS_STOP_GRACE_MS))) {
    return;
  }

  const killSent = signalProcess(pid, "SIGKILL");
  if (!killSent || (await waitForProcessExit(pid, PROCESS_FORCE_STOP_GRACE_MS))) {
    return;
  }

  throw new Error(`Failed to kill process ${pid}`);
};

const signalProcess = (pid: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
};

const waitForProcessExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await sleep(PROCESS_STOP_POLL_MS);
  } while (Date.now() < deadline);

  return !isProcessRunning(pid);
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code !== "ESRCH";
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const runCommand = async (command: Command, options: RunOptions = {}): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  if (exitCode === 0 || options.allowFailure) {
    return;
  }

  throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
};

if (import.meta.main) {
  await runSourceUninstall();
}
