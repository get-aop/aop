// ExecHost — the single seam that owns subprocess creation for agent and runtime spawns.
//
// Providers and the executor describe *what* to run via an ExecHostSpawnSpec; the host
// decides *how* to spawn it on the current platform. This is the abstraction that lets the
// same code run on native macOS/Linux and native Windows (and, via Model B, inside a WSL
// distro as native Linux) — see docs/adr/windows-wsl-execution-model.md — without each
// call site branching on OS.
//
// The native hosts are faithful pass-throughs to Bun.spawn; only the shell and
// command-existence probes differ by platform (zsh/`command -v` vs cmd/`where`).
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

export type ExecHostKind = "native-unix" | "native-windows" | "wsl" | "ssh";

export interface ExecHost {
  readonly kind: ExecHostKind;
  /** Spawn a process and return the live subprocess handle. */
  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess;
  /** Run a shell script string (the host picks the platform shell). */
  shell(script: string, options?: ExecHostShellOptions): Bun.Subprocess;
  /** Resolve whether a command is available on PATH. */
  commandExists(name: string): Promise<boolean>;
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

/**
 * Build the argv for a "does this command exist on PATH" probe. The unix form passes the
 * name as `$0` to avoid shell injection; the Windows form uses `where`.
 */
export const commandExistsInvocation = (
  kind: ExecHostKind,
  name: string,
  unixShell: string = resolveUnixShell(),
): string[] =>
  kind === "native-windows" ? ["where", name] : [unixShell, "-lc", 'command -v "$0"', name];

const probeCommandExists = async (kind: ExecHostKind, name: string): Promise<boolean> => {
  try {
    const proc = spawnWithBun({
      cmd: commandExistsInvocation(kind, name),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
};

/** Shared native-host behavior; only `kind` (which selects the shell) differs. */
abstract class BaseNativeHost implements ExecHost {
  abstract readonly kind: ExecHostKind;

  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess {
    return spawnWithBun(spec);
  }

  shell(script: string, options: ExecHostShellOptions = {}): Bun.Subprocess {
    return spawnWithBun({ cmd: shellInvocation(this.kind, script), ...options });
  }

  commandExists(name: string): Promise<boolean> {
    return probeCommandExists(this.kind, name);
  }
}

/** Native macOS/Linux execution host (`zsh -lc` when available, else `sh -lc`). */
export class NativeUnixHost extends BaseNativeHost {
  readonly kind = "native-unix" as const;
}

/** Native Windows execution host (`cmd /c`, `where`). Bun.spawn resolves .exe via PATHEXT. */
export class NativeWindowsHost extends BaseNativeHost {
  readonly kind = "native-windows" as const;
}

/**
 * Resolve the execution host for the current platform and AOP_EXEC_HOST setting.
 *
 * - darwin/linux → NativeUnixHost. Under WSL Model B the sidecar already runs *inside*
 *   the distro as a native Linux process, so `AOP_EXEC_HOST=wsl:<distro>` still resolves
 *   here — the `wsl:` form only tells the desktop how to launch the sidecar.
 * - win32 → NativeWindowsHost. `AOP_EXEC_HOST=wsl:<distro>` on Windows would be Model A
 *   (per-command wsl.exe wrapping), which is out of scope.
 */
export const resolveExecHost = (
  platform: NodeJS.Platform = process.platform,
  execHost: string | undefined = process.env.AOP_EXEC_HOST,
): ExecHost => {
  if (platform === "win32") {
    if (execHost?.startsWith("wsl:")) {
      throw new Error(
        "ExecHost: WSL Model A (per-command wsl.exe wrapping) is out of scope. The in-distro " +
          "sidecar (Model B) runs as native Linux — see docs/adr/windows-wsl-execution-model.md",
      );
    }
    return new NativeWindowsHost();
  }
  return new NativeUnixHost();
};
