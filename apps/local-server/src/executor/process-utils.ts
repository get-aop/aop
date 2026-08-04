import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

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

export const isClaudeProcess = (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  try {
    if (platform === "linux") {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      return isAgentCommand(cmdline);
    }
    if (platform === "win32") {
      // WMI exposes the command line (but not the environment block).
      const cmd = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: "utf-8" },
      );
      return isAgentCommand(cmd);
    }
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" });
    return isAgentCommand(cmd);
  } catch {
    return false;
  }
};

export const isAgentCommand = (command: string): boolean => {
  return command.includes("claude") || /(?:^|\/|\s)codex(?:\.js)?(?:\s|$).*?\bexec\b/.test(command);
};

export const findPidByStepId = (
  stepId: string,
  platform: NodeJS.Platform = process.platform,
): number | null => {
  if (platform === "linux") {
    return findPidByEnvLinux("AOP_STEP_ID", stepId);
  }
  // Native Windows can't read another process's environment (no /proc; WMI exposes the
  // command line but not the environment block), so env-by-PID reattach is unsupported.
  // Under WSL Model B the sidecar runs in-distro and uses the Linux /proc path above.
  if (platform === "win32") {
    return null;
  }
  return findPidByEnvMacOS("AOP_STEP_ID", stepId);
};

export const findPidsByTaskId = (
  taskId: string,
  platform: NodeJS.Platform = process.platform,
): number[] => {
  if (platform === "linux") {
    return findPidsByEnvLinux("AOP_TASK_ID", taskId);
  }
  if (platform === "win32") {
    return [];
  }
  return findPidsByEnvMacOS("AOP_TASK_ID", taskId);
};

export const findPidByEnvLinux = (envKey: string, envValue: string): number | null => {
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);

    for (const pid of pids) {
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (
          environ.includes(`${envKey}=${envValue}\0`) ||
          environ.endsWith(`${envKey}=${envValue}`)
        ) {
          return pid;
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available
  }
  return null;
};

export const findPidsByEnvLinux = (envKey: string, envValue: string): number[] => {
  const result: number[] = [];
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);

    for (const pid of pids) {
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (
          environ.includes(`${envKey}=${envValue}\0`) ||
          environ.endsWith(`${envKey}=${envValue}`)
        ) {
          result.push(pid);
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available
  }
  return result;
};

const getAgentPidsMacOS = (): Array<{ pid: number; env: string }> => {
  try {
    const psOutput = execSync("ps eww -eo pid,command", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return psOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), env: match[2] ?? "" };
      })
      .filter(
        (entry): entry is { pid: number; env: string } =>
          entry !== null && isAgentCommand(entry.env),
      );
  } catch {
    return [];
  }
};

const findPidByEnvMacOS = (envKey: string, envValue: string): number | null => {
  const target = `${envKey}=${envValue}`;
  // Fast path: check known PID from caller context if available
  for (const { pid, env } of getAgentPidsMacOS()) {
    if (env.includes(target)) return pid;
  }
  return null;
};

const findPidsByEnvMacOS = (envKey: string, envValue: string): number[] => {
  const target = `${envKey}=${envValue}`;
  return getAgentPidsMacOS()
    .filter(({ env }) => env.includes(target))
    .map(({ pid }) => pid);
};
