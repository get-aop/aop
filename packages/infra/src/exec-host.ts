// ExecHost — the single seam that owns subprocess creation for agent and runtime spawns.
//
// Providers describe *what* to run via an ExecHostSpawnSpec; the host decides *how* to spawn
// it on the current platform, so call sites do not branch on OS.
//
// The native hosts are faithful pass-throughs to Bun.spawn; only the shell differs by
// platform (zsh -lc vs cmd /c).
// Unix prefers the user's zsh so login PATH and interactive-shell expectations match the
// terminal; falls back to sh when zsh is missing.

import { existsSync } from "node:fs";

/** How to wire a single stdio stream. `{ file }` redirects to a file path (via Bun.file). */
export type ExecHostStdio = "ignore" | "inherit" | "pipe" | { readonly file: string };

export interface ExecHostSpawnSpec {
  /** Program and arguments. The first entry is resolved against PATH. */
  readonly cmd: readonly string[];
  readonly cwd?: string;
  /** Matches Bun's env type: an `undefined` value unsets that variable. */
  readonly env?: Record<string, string | undefined>;
  readonly stdin?: ExecHostStdio;
  readonly stdout?: ExecHostStdio;
  readonly stderr?: ExecHostStdio;
  /** Start in a new process group so the child can outlive the parent. */
  readonly detached?: boolean;
  /** Call `proc.unref()` after spawn so the parent can exit independently. */
  readonly unref?: boolean;
}

export type ExecHostShellOptions = Omit<ExecHostSpawnSpec, "cmd" | "detached" | "unref">;

export type ExecHostKind = "native-unix" | "native-windows";

export interface ExecHost {
  readonly kind: ExecHostKind;
  /** Spawn a process and return the live subprocess handle. */
  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess;
  /** Run a shell script string (the host picks the platform shell). */
  shell(script: string, options?: ExecHostShellOptions): Bun.Subprocess;
}

type BunStdio = "ignore" | "inherit" | "pipe" | ReturnType<typeof Bun.file> | undefined;

const toBunStdio = (target: ExecHostStdio | undefined): BunStdio => {
  if (target === undefined || typeof target === "string") {
    return target;
  }
  return Bun.file(target.file);
};

const spawnWithBun = (spec: ExecHostSpawnSpec): Bun.Subprocess => {
  const proc = Bun.spawn({
    cmd: [...spec.cmd],
    cwd: spec.cwd,
    env: spec.env,
    stdin: toBunStdio(spec.stdin),
    stdout: toBunStdio(spec.stdout),
    stderr: toBunStdio(spec.stderr),
    detached: spec.detached,
  });
  if (spec.unref) {
    proc.unref();
  }
  return proc;
};

/**
 * Prefer zsh on Unix so AOP matches a typical macOS/dev login shell.
 * Override with AOP_UNIX_SHELL; fall back to sh when zsh is unavailable.
 */
export const resolveUnixShell = (
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = (name) => Bun.which(name),
): string => {
  const override = env.AOP_UNIX_SHELL?.trim();
  if (override) return override;

  const shellEnv = env.SHELL?.trim();
  if (shellEnv && /(?:^|\/)zsh$/.test(shellEnv) && pathExists(shellEnv)) {
    return shellEnv;
  }

  for (const candidate of ["/bin/zsh", "/usr/bin/zsh"]) {
    if (pathExists(candidate)) return candidate;
  }

  return which("zsh") ?? "sh";
};

/**
 * Build the argv for running a shell script string on a given host. Exported so the
 * Windows form can be asserted by unit tests on a non-Windows runner.
 */
export const shellInvocation = (
  kind: ExecHostKind,
  script: string,
  unixShell: string = resolveUnixShell(),
): string[] => (kind === "native-windows" ? ["cmd", "/c", script] : [unixShell, "-lc", script]);

/** Shared native-host behavior; only `kind` (which selects the shell) differs. */
abstract class BaseNativeHost implements ExecHost {
  abstract readonly kind: ExecHostKind;

  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess {
    return spawnWithBun(spec);
  }

  shell(script: string, options: ExecHostShellOptions = {}): Bun.Subprocess {
    return spawnWithBun({ cmd: shellInvocation(this.kind, script), ...options });
  }
}

/** Native macOS/Linux execution host (`zsh -lc` when available, else `sh -lc`). */
export class NativeUnixHost extends BaseNativeHost {
  readonly kind = "native-unix" as const;
}

/** Native Windows execution host (`cmd /c`). Bun.spawn resolves .exe via PATHEXT. */
export class NativeWindowsHost extends BaseNativeHost {
  readonly kind = "native-windows" as const;
}

/** The execution host for the current platform: native Windows on win32, native Unix elsewhere. */
export const resolveExecHost = (platform: NodeJS.Platform = process.platform): ExecHost =>
  platform === "win32" ? new NativeWindowsHost() : new NativeUnixHost();
