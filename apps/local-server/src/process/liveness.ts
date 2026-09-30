import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** How often a detached agent's pid is polled for exit. */
export const REAPER_POLL_INTERVAL_MS = 2000;

const CODEX_EXEC_COMMAND = /(?:^|\/|\s)codex(?:\.js)?(?:\s|$).*?\bexec\b/;

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Detects zombie processes (exited but not reaped by parent). */
export const isZombie = (pid: number, platform: NodeJS.Platform = process.platform): boolean => {
  // Windows has no zombie concept and no `ps`; process.kill(pid, 0) liveness is
  // authoritative, so never shell out here (the old code threw on every poll).
  if (platform === "win32") {
    return false;
  }
  try {
    if (platform === "linux") {
      const status = readFileSync(`/proc/${pid}/status`, "utf-8");
      return /^State:\s+Z/m.test(status);
    }
    const state = execSync(`ps -p ${pid} -o state=`, {
      encoding: "utf-8",
    }).trim();
    return state === "Z";
  } catch {
    return false;
  }
};

/** Returns true only if the process is alive AND not a zombie. */
export const isAgentRunning = (pid: number): boolean => {
  return isProcessAlive(pid) && !isZombie(pid);
};

/**
 * Pid identity check for a process recorded by an earlier server: the pid may
 * have been reused, so only signal it when its command line is an agent CLI.
 * `executable` is the run's configured runtime alias (for example an absolute
 * path), which may not contain the word "claude".
 */
export const isAgentProcess = (
  pid: number,
  options: { executable?: string | null; platform?: NodeJS.Platform } = {},
): boolean => {
  const command = readProcessCommand(pid, options.platform ?? process.platform);
  return command !== null && isAgentCommand(command, options.executable);
};

export const isAgentCommand = (command: string, executable?: string | null): boolean =>
  command.includes("claude") ||
  CODEX_EXEC_COMMAND.test(command) ||
  Boolean(executable?.trim() && command.includes(executable.trim()));

/** Resolves once the process has exited or become a zombie. */
export const pollForProcessExit = (
  pid: number,
  intervalMs: number = REAPER_POLL_INTERVAL_MS,
): Promise<void> =>
  new Promise((resolve) => {
    if (!isAgentRunning(pid)) {
      resolve();
      return;
    }
    const interval = setInterval(() => {
      if (!isAgentRunning(pid)) {
        clearInterval(interval);
        resolve();
      }
    }, intervalMs);
  });

const readProcessCommand = (pid: number, platform: NodeJS.Platform): string | null => {
  try {
    if (platform === "linux") {
      return readFileSync(`/proc/${pid}/cmdline`, "utf-8").replaceAll("\0", " ");
    }
    if (platform === "win32") {
      // WMI exposes the command line (but not the environment block).
      return execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: "utf-8" },
      );
    }
    return execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" });
  } catch {
    return null;
  }
};
