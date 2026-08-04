// SshExecHost — ExecHost that wraps the system OpenSSH client as a local Bun.Subprocess.
//
// Remote agent spawns still look like local PIDs to the executor (the local `ssh` process).
// Env for agent spawns (stdin: "ignore") is forwarded as KEY=value lines over ssh stdin into
// a remote bootstrap so secrets never appear in remote ps/argv. When the caller needs real
// stdin, env falls back to inline `export` assignments (visible in remote process listings).
//
// Forwarded env is sanitized: machine-identity vars (PATH, HOME, TMPDIR, …) stay local so
// the remote login shell's own values win — forwarding them would break remote CLI
// resolution and auth lookup. Keys that are not valid POSIX names and values containing
// newlines are dropped: the stdin protocol is line-based and `eval`s each line, so they
// cannot be represented safely.
//
// POSIX remotes only in v1.

import type {
  ExecHost,
  ExecHostShellOptions,
  ExecHostSpawnSpec,
  ExecHostStdio,
} from "./exec-host.ts";

/** SSH connection fields needed by SshExecHost (structurally matches ExecHostConfig). */
export type SshHostConfig = {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly user?: string;
  readonly port?: number;
  readonly identityFile?: string;
  readonly remoteRoot: string;
};

export type PathMapEntry = { readonly local: string; readonly remote: string };

export type SshSpawnImpl = (
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: ExecHostStdio | ReturnType<typeof Bun.file> | undefined;
    stdout?: ExecHostStdio | ReturnType<typeof Bun.file> | undefined;
    stderr?: ExecHostStdio | ReturnType<typeof Bun.file> | undefined;
    detached?: boolean;
  },
) => Bun.Subprocess;

export type SshExecHostOptions = {
  readonly pathMap: readonly PathMapEntry[];
  /** Injected for unit tests; defaults to Bun.spawn. */
  readonly spawnImpl?: SshSpawnImpl;
};

/** Single-quote a string for POSIX sh (safe against spaces, quotes, $, etc.). */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** SSH option prefix shared by ssh invocations and rsync's `-e` transport. */
export const sshBaseArgs = (config: Pick<SshHostConfig, "port" | "identityFile">): string[] => {
  const argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];
  if (config.port !== undefined) {
    argv.push("-p", String(config.port));
  }
  if (config.identityFile) {
    argv.push("-i", config.identityFile);
  }
  return argv;
};

/** `user@host` (or bare host) target string for ssh/rsync/scp. */
export const sshTarget = (config: Pick<SshHostConfig, "user" | "host">): string =>
  config.user ? `${config.user}@${config.host}` : config.host;

/** Build the local OpenSSH argv wrapping a remote command string. */
export const sshInvocation = (config: SshHostConfig, remoteCommand: string): string[] => [
  ...sshBaseArgs(config),
  sshTarget(config),
  "--",
  remoteCommand,
];

/** Build `cd <cwd> && exec <cmd...>` for a POSIX remote shell. */
export const remoteScript = (cwd: string | undefined, cmd: readonly string[]): string => {
  const execPart = `exec ${cmd.map(shellQuote).join(" ")}`;
  if (!cwd) {
    return execPart;
  }
  return `cd ${shellQuote(cwd)} && ${execPart}`;
};

const ENV_BOOTSTRAP =
  'set -a; while IFS= read -r line || [ -n "$line" ]; do eval "$line"; done; set +a; ';

// Machine-identity env that must come from the remote login shell, not the local server.
const LOCAL_ONLY_ENV = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "USER",
  "LOGNAME",
  "MAIL",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "DISPLAY",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "COLORTERM",
]);
const LOCAL_ONLY_ENV_PREFIXES = ["XPC_", "__CF"];
const POSIX_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Filter spawn env down to entries that are safe and meaningful to forward remotely.
 * Drops machine-identity vars (see module comment), non-POSIX names (e.g. bash's
 * exported-function `BASH_FUNC_x%%` keys), and newline-containing values — the
 * line-based stdin protocol `eval`s each line, so those would execute as raw shell.
 */
export const sanitizeForwardedEnv = (
  env: Record<string, string | undefined>,
): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value.includes("\n")) continue;
    if (!POSIX_ENV_NAME.test(key)) continue;
    if (LOCAL_ONLY_ENV.has(key)) continue;
    if (LOCAL_ONLY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    forwarded[key] = value;
  }
  return forwarded;
};

type BunStdio = "ignore" | "inherit" | "pipe" | ReturnType<typeof Bun.file> | undefined;

const toBunStdio = (target: ExecHostStdio | undefined): BunStdio => {
  if (target === undefined || typeof target === "string") {
    return target;
  }
  return Bun.file(target.file);
};

const defaultSpawnImpl: SshSpawnImpl = (cmd, options) => {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: options.env as Record<string, string | undefined> | undefined,
    stdin: options.stdin as BunStdio,
    stdout: options.stdout as BunStdio,
    stderr: options.stderr as BunStdio,
    detached: options.detached,
  });
  return proc;
};

const normalizeLocalPath = (path: string): string => {
  // Strip trailing slashes so prefix matching is stable.
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
};

export class SshExecHost implements ExecHost {
  readonly kind = "ssh" as const;
  readonly config: SshHostConfig;
  private readonly pathMap: readonly PathMapEntry[];
  private readonly spawnImpl: SshSpawnImpl;

  constructor(config: SshHostConfig, options: SshExecHostOptions) {
    this.config = config;
    this.pathMap = options.pathMap;
    this.spawnImpl = options.spawnImpl ?? defaultSpawnImpl;
  }

  /** KEY=value lines written to remote stdin before the bootstrap runs the command. */
  static buildEnvStdinPayload(env: Record<string, string>): string {
    // Values are shell-quoted so the remote `eval` is safe.
    const lines = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess {
    const remoteCwd = spec.cwd !== undefined ? this.mapCwd(spec.cwd) : undefined;
    const forwardedEnv = spec.env ? sanitizeForwardedEnv(spec.env) : undefined;
    const hasEnv = Boolean(forwardedEnv && Object.keys(forwardedEnv).length > 0);
    const useEnvStdin = spec.stdin === "ignore" && hasEnv;
    const remoteCommand = buildRemoteCommand(remoteCwd, spec.cmd, forwardedEnv, useEnvStdin);
    const argv = sshInvocation(this.config, remoteCommand);

    const proc = this.spawnImpl(argv, {
      env: process.env as Record<string, string | undefined>,
      stdin: useEnvStdin ? "pipe" : toBunStdio(spec.stdin),
      stdout: toBunStdio(spec.stdout),
      stderr: toBunStdio(spec.stderr),
      detached: spec.detached,
    });

    if (useEnvStdin && forwardedEnv) {
      writeEnvPayload(proc, SshExecHost.buildEnvStdinPayload(forwardedEnv));
    }
    if (spec.unref) {
      proc.unref();
    }
    return proc;
  }

  shell(script: string, options: ExecHostShellOptions = {}): Bun.Subprocess {
    return this.spawn({
      cmd: ["sh", "-lc", script],
      ...options,
    });
  }

  async commandExists(name: string): Promise<boolean> {
    try {
      // Name is shell-quoted inside the remote script (ssh cannot pass $0 safely).
      const probe = sshInvocation(
        this.config,
        `sh -lc ${shellQuote(`command -v ${shellQuote(name)}`)}`,
      );
      const proc = this.spawnImpl(probe, {
        env: process.env as Record<string, string | undefined>,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }

  private mapCwd(localCwd: string): string {
    const normalized = normalizeLocalPath(localCwd);
    for (const entry of this.pathMap) {
      const localRoot = normalizeLocalPath(entry.local);
      if (normalized === localRoot || normalized.startsWith(`${localRoot}/`)) {
        const suffix = normalized.slice(localRoot.length);
        return `${normalizeLocalPath(entry.remote)}${suffix}`;
      }
    }
    // Empty pathMap: pass cwd through (test / probe hosts). Non-empty: require a match.
    if (this.pathMap.length === 0) {
      return localCwd;
    }
    throw new Error(
      `SshExecHost: cwd is not on the path map: ${localCwd}. ` +
        `Mapped roots: ${this.pathMap.map((e) => e.local).join(", ") || "(none)"}`,
    );
  }
}

const buildRemoteCommand = (
  remoteCwd: string | undefined,
  cmd: readonly string[],
  env: Record<string, string> | undefined,
  useEnvStdin: boolean,
): string => {
  const body = remoteScript(remoteCwd, cmd);
  if (useEnvStdin) {
    return `${ENV_BOOTSTRAP}${body}`;
  }
  if (env && Object.keys(env).length > 0) {
    // Caller needs real stdin — inline exports (visible in remote ps).
    const exports = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
      .join("; ");
    return `${exports}; ${body}`;
  }
  return body;
};

const writeEnvPayload = (proc: Bun.Subprocess, payload: string): void => {
  const stdin = proc.stdin;
  if (!stdin || typeof stdin === "number") {
    return;
  }
  // Bun FileSink
  if ("write" in stdin && typeof stdin.write === "function") {
    stdin.write(payload);
    if ("end" in stdin && typeof stdin.end === "function") {
      stdin.end();
    }
  }
};
