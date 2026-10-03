import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname } from "node:path";
import { buildSpawnEnv } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";

/**
 * What computer-use setup and the readiness check need from the machine, behind one seam so the
 * tests run them against a fake one. Every method that changes something is named for it.
 */
export interface SetupSystem {
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  user: string;
  env: Record<string, string | undefined>;
  /** Runs argv and answers its exit code and output (stdout then stderr); never throws. */
  run: (argv: string[], options?: RunOptions) => Promise<RunResult>;
  /** The absolute path of a command on the PATH, or null. */
  which: (command: string) => string | null;
  exists: (path: string) => boolean;
  /** Names in a directory; empty when it cannot be read. */
  list: (path: string) => string[];
  /** Whether root owns `path` (CUA Driver accepts only root-owned browsers on Linux). */
  rootOwned: (path: string) => boolean;
  readText: (path: string) => string | null;
  writeText: (path: string, text: string) => void;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /** Lets the command talk to the person's terminal (sudo's password prompt, macOS dialogs). */
  interactive?: boolean;
}

export interface RunResult {
  exitCode: number;
  output: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export const hostSystem = (): SetupSystem => ({
  platform: process.platform,
  arch: process.arch,
  home: homedir(),
  user: safeUser(),
  env: process.env,
  run: runCommand,
  which: (command) => {
    const resolved = resolveRuntimeExecutable(command, buildSpawnEnv().PATH);
    return resolved.startsWith("/") ? resolved : null;
  },
  exists: existsSync,
  list: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  rootOwned: (path) => {
    try {
      return statSync(path).uid === 0;
    } catch {
      return false;
    }
  },
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeText: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
});

const runCommand = async (argv: string[], options: RunOptions = {}): Promise<RunResult> => {
  try {
    const child = Bun.spawn(argv, {
      env: { ...buildSpawnEnv(), ...options.env },
      stdin: options.interactive ? "inherit" : "ignore",
      stdout: options.interactive ? "inherit" : "pipe",
      stderr: options.interactive ? "inherit" : "pipe",
    });
    const timer = setTimeout(
      () => child.kill("SIGTERM"),
      options.timeoutMs ?? (options.interactive ? 30 * 60_000 : DEFAULT_TIMEOUT_MS),
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      child.stdout instanceof ReadableStream ? new Response(child.stdout).text() : "",
      child.stderr instanceof ReadableStream ? new Response(child.stderr).text() : "",
      child.exited,
    ]);
    clearTimeout(timer);
    return { exitCode, output: `${stdout}${stderr}` };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
};

// Bun answers "unknown" for a user it cannot look up (a container user without a home entry
// it reads), so the login name the shell knows comes first, then `id -un`.
const safeUser = (): string => {
  const named = process.env.USER?.trim() || process.env.LOGNAME?.trim();
  if (named) return named;
  try {
    const name = userInfo().username;
    if (name && name !== "unknown") return name;
  } catch {
    // Fall through to `id`.
  }
  const id = Bun.spawnSync(["id", "-un"], { stdout: "pipe", stderr: "ignore" });
  return id.exitCode === 0 ? id.stdout.toString().trim() : "";
};
