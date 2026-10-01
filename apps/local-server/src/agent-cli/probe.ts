import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { buildSpawnEnv } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";
import type { AgentCliDefinition } from "./definitions.ts";
import { parseCliVersion } from "./version.ts";

const VERSION_TIMEOUT_MS = 15_000;

/** What is installed for one CLI right now. */
export interface CliProbe {
  path: string | null;
  realPath: string | null;
  version: string | null;
  /** Why the version could not be read from an installed CLI. */
  error: string | null;
}

export interface ProbeDeps {
  /** Where `command` resolves, the way a run's spawn resolves it; null when it is not installed. */
  locate: (command: string) => string | null;
  resolveLink: (path: string) => Promise<string>;
  /** Runs argv and returns its exit code and output; rejects on timeout. */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>;
}

/** Finds the command a session would launch now and asks it its version. */
export const probeCli = async (
  definition: AgentCliDefinition,
  deps: ProbeDeps = defaultProbeDeps,
): Promise<CliProbe> => {
  const path = deps.locate(definition.command);
  if (!path) return { path: null, realPath: null, version: null, error: null };
  const realPath = await deps.resolveLink(path).catch(() => path);
  try {
    const result = await deps.run([path, "--version"], VERSION_TIMEOUT_MS);
    const version = result.exitCode === 0 ? parseCliVersion(result.output) : null;
    const error = version ? null : `\`${definition.command} --version\` printed no version`;
    return { path, realPath, version, error };
  } catch (error) {
    return { path, realPath, version: null, error: messageOf(error) };
  }
};

export const runWithTimeout = async (
  argv: string[],
  timeoutMs: number,
  options: { env?: Record<string, string>; onOutput?: (chunk: string) => void } = {},
): Promise<{ exitCode: number; output: string }> => {
  const proc = Bun.spawn({
    cmd: argv,
    env: options.env ?? buildSpawnEnv(),
    // No terminal: a command that would prompt (for a password, say) fails instead of hanging.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A child that keeps the pipes open after the kill must not hold the caller, so the deadline
  // is raced, not awaited through the streams.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`\`${argv.join(" ")}\` did not finish within ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        readStream(proc.stdout, options.onOutput),
        readStream(proc.stderr, options.onOutput),
        proc.exited,
      ]),
      deadline,
    ]);
    return { exitCode, output: `${stdout}${stderr}` };
  } finally {
    clearTimeout(timer);
  }
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const defaultProbeDeps: ProbeDeps = {
  locate: (command) => {
    const resolved = resolveRuntimeExecutable(command, buildSpawnEnv().PATH);
    // A name it could not find comes back bare.
    return isAbsolute(resolved) ? resolved : null;
  },
  resolveLink: realpath,
  run: (argv, timeoutMs) => runWithTimeout(argv, timeoutMs),
};

const readStream = async (
  stream: ReadableStream<Uint8Array>,
  onOutput: ((chunk: string) => void) | undefined,
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    const piece = decoder.decode(chunk, { stream: true });
    text += piece;
    onOutput?.(piece);
  }
  return text;
};
