import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, sep } from "node:path";
import { aopPaths } from "./aop-paths.ts";
import { resolveUnixShell } from "./exec-host.ts";

let cachedLoginShellEnv: Record<string, string> | null = null;
let loginShellEnvLoaded = false;

export const buildSpawnEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const shellEnv = getCachedLoginShellEnv();
  const mergedEnv = {
    ...shellEnv,
    ...process.env,
    ...(extraEnv ?? {}),
  } as Record<string, string>;

  if (!mergedEnv.HOME?.trim()) {
    mergedEnv.HOME = homedir();
  }
  mergedEnv.PATH = mergePath(mergedEnv.PATH, shellEnv.PATH);
  removeLegacyGitGuardrails(mergedEnv);
  return mergedEnv;
};

/** Prefer Claude Pro/Max subscription auth over API key billing for Claude Code spawns. */
export const buildClaudeCodeSpawnEnv = (
  extraEnv?: Record<string, string>,
): Record<string, string> => {
  const env = buildSpawnEnv(extraEnv);
  delete env.ANTHROPIC_API_KEY;
  return env;
};

export const resetSpawnEnvCacheForTests = (): void => {
  loginShellEnvLoaded = false;
  cachedLoginShellEnv = null;
};

const buildFallbackPaths = (): string[] => {
  const home = homedir();
  return [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    `${home}/.local/bin`,
    `${home}/.local/share/pnpm`,
    `${home}/.local/share/pnpm/nodejs_current/bin`,
    `${home}/.opencode/bin`,
    `${home}/.bun/bin`,
    `${home}/bin`,
  ];
};

const mergePath = (...rawPaths: Array<string | undefined>): string => {
  const parts = rawPaths.flatMap((rawPath) => (rawPath ?? "").split(delimiter).filter(Boolean));

  for (const candidate of buildFallbackPaths()) {
    if (!parts.includes(candidate)) {
      parts.push(candidate);
    }
  }

  return parts.join(delimiter);
};

const removeLegacyGitGuardrails = (env: Record<string, string>): void => {
  const legacyRoot = join(aopPaths.home(), "guardrails");
  env.PATH = (env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry !== legacyRoot && !entry.startsWith(`${legacyRoot}${sep}`))
    .join(delimiter);
  delete env.AOP_REAL_GIT;
};

const getCachedLoginShellEnv = (): Record<string, string> => {
  if (!loginShellEnvLoaded) {
    cachedLoginShellEnv = readLoginShellEnv();
    loginShellEnvLoaded = true;
  }

  return cachedLoginShellEnv ?? {};
};

const readLoginShellEnv = (): Record<string, string> => {
  if (process.env.AOP_DISABLE_LOGIN_SHELL_ENV === "1" || process.platform === "win32") {
    return {};
  }

  const shell = resolveLoginShell();
  if (!shell) return {};

  try {
    const proc = Bun.spawnSync({
      cmd: [shell, "-lc", "/usr/bin/env -0"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, AOP_DISABLE_LOGIN_SHELL_ENV: "1" },
    });

    if (proc.exitCode !== 0) {
      return {};
    }

    const shellEnv = parseNullSeparatedEnv(proc.stdout);
    // The probe guard above gets echoed back by `env -0`; keeping it would disable
    // login-shell env for every process spawned with this merged env.
    delete shellEnv.AOP_DISABLE_LOGIN_SHELL_ENV;
    return shellEnv;
  } catch {
    return {};
  }
};

const resolveLoginShell = (): string | null => {
  if (process.platform === "win32") return null;

  const configured = process.env.SHELL?.trim();
  if (configured && existsSync(configured)) return configured;

  // Prefer zsh (same as ExecHost unix shell) so PATH matches interactive terminals.
  const preferred = preferExistingUnixShell(resolveUnixShell());
  if (preferred) return preferred;

  const fallbacks =
    process.platform === "darwin"
      ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
      : ["/bin/bash", "/bin/zsh", "/bin/sh"];
  return fallbacks.find((candidate) => existsSync(candidate)) ?? null;
};

const preferExistingUnixShell = (unixShell: string): string | null => {
  if (unixShell !== "sh" && existsSync(unixShell)) return unixShell;
  if (unixShell === "zsh" || unixShell.endsWith("/zsh")) {
    return Bun.which("zsh");
  }
  return null;
};

const parseNullSeparatedEnv = (stdout: Uint8Array): Record<string, string> => {
  const env: Record<string, string> = {};
  const entries = Buffer.from(stdout).toString("utf8").split("\0");

  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;

    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }

  return env;
};
