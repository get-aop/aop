export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion. A non-zero exit is a value, not an exception: the harness records it. */
export const shell = async (
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<ShellResult> => {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: options.env as Record<string, string> | undefined,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/** Like `shell`, but throws with the command's own words when it fails. */
export const shellOk = async (
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> => {
  const result = await shell(cmd, options);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited ${result.exitCode}: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

export const waitFor = async <T>(
  description: string,
  probe: () => Promise<T | undefined> | T | undefined,
  options: { timeoutMs: number; everyMs?: number },
): Promise<T> => {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(options.everyMs ?? 1500);
  }
  throw new Error(
    `Timed out after ${Math.round(options.timeoutMs / 1000)}s waiting for ${description}`,
  );
};
