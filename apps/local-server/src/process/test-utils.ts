import { readFileSync } from "node:fs";

/**
 * Spawns `command` and resolves once the child runs it. On Linux `Bun.spawn` returns before the
 * child has exec'd, so for a moment `/proc/<pid>/cmdline` does not name the program yet and a
 * command-line identity check would see some other process. macOS only returns after the exec.
 */
export const spawnRunning = async (command: string[], options: { detached?: boolean } = {}) => {
  const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore", ...options });
  if (process.platform === "linux") await waitForExec(proc.pid, command[0] ?? "");
  return proc;
};

const waitForExec = async (pid: number, program: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (firstArgOf(pid) === program) return;
    await Bun.sleep(5);
  }
  throw new Error(`Process ${pid} never started ${program}`);
};

const firstArgOf = (pid: number): string | undefined => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0")[0];
  } catch {
    return undefined;
  }
};
