export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class CommandTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Command timed out after ${timeoutMs}ms`);
    this.name = "CommandTimeoutError";
  }
}

export class CommandCancelledError extends Error {
  constructor() {
    super("Command was cancelled");
    this.name = "CommandCancelledError";
  }
}

/** Injectable shell seam: every git/gh call in the server goes through one of these. */
export type RunCommand = (
  args: string[],
  cwd: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

// Cap concurrent git/gh subprocesses so parallel health/status checks cannot
// spawn an unbounded number of processes at once.
const MAX_CONCURRENT_SUBPROCESSES = 8;
let activeSubprocesses = 0;
const subprocessWaiters: Array<() => void> = [];

const acquireSubprocessSlot = async (): Promise<void> => {
  if (activeSubprocesses < MAX_CONCURRENT_SUBPROCESSES) {
    activeSubprocesses++;
    return;
  }
  await new Promise<void>((resolve) => {
    subprocessWaiters.push(resolve);
  });
  activeSubprocesses++;
};

const releaseSubprocessSlot = (): void => {
  activeSubprocesses--;
  const next = subprocessWaiters.shift();
  if (next) next();
};

export const createDefaultRunner =
  (binary: string): RunCommand =>
  async (args, cwd, options = {}) => {
    const abort = createCommandAbort(options);
    await acquireSubprocessSlot();
    try {
      const process = Bun.spawn([binary, ...args], {
        cwd,
        env: mergeEnvironment(options.env),
        stdout: "pipe",
        stderr: "pipe",
        signal: abort.signal,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      abort.throwIfAborted();
      return { exitCode, stdout, stderr };
    } finally {
      releaseSubprocessSlot();
      abort.dispose();
    }
  };

interface CommandAbort {
  signal: AbortSignal;
  throwIfAborted: () => void;
  dispose: () => void;
}

const createCommandAbort = (options: RunCommandOptions): CommandAbort => {
  if (options.signal?.aborted) throw new CommandCancelledError();
  const controller = new AbortController();
  let reason: "timeout" | "cancelled" | null = null;
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        reason = "timeout";
        controller.abort();
      }, options.timeoutMs)
    : null;
  const cancel = () => {
    reason = "cancelled";
    controller.abort();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  return {
    signal: controller.signal,
    throwIfAborted: () => {
      if (reason === "timeout") throw new CommandTimeoutError(options.timeoutMs ?? 0);
      if (reason === "cancelled") throw new CommandCancelledError();
    },
    dispose: () => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    },
  };
};

const mergeEnvironment = (
  overrides: Record<string, string | undefined> | undefined,
): Record<string, string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
};

export const defaultGitRunner: RunCommand = createDefaultRunner("git");
export const defaultGhRunner: RunCommand = createDefaultRunner("gh");
