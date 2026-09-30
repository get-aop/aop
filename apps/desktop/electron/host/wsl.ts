import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { WslDistro } from "../../src/backend/types";
import { currentPlatform } from "./platform";
import type { CommandOutput, CommandRunner, CommandSpec, HostPlatform } from "./types";

const execFileAsync = promisify(execFile);
const WSL_USER_CLI_PATH_SETUP =
  'for aop_cli_bin_dir in "$HOME/.local/bin" "$HOME/.bun/bin" "$HOME/.npm-global/bin" "$HOME/.npm/bin" "$HOME/.volta/bin" "$HOME/.asdf/shims" "$HOME/.local/share/pnpm" "$HOME/.local/share/mise/shims" "$HOME/.yarn/bin" "$HOME"/.nvm/versions/node/*/bin "$HOME"/.local/share/fnm/node-versions/*/installation/bin; do [ -d "$aop_cli_bin_dir" ] && PATH="$aop_cli_bin_dir:$PATH"; done; export PATH';

export type ExecHostMode = { kind: "native" } | { kind: "wsl"; distro: string };

export const decodeWslOutput = (bytes: Uint8Array): string => {
  const hasBom = bytes[0] === 0xff && bytes[1] === 0xfe;
  const looksUtf16 = hasBom || [...bytes].some((byte, index) => index % 2 === 1 && byte === 0);
  if (!looksUtf16) return Buffer.from(bytes).toString("utf8");
  const start = hasBom ? 2 : 0;
  return Buffer.from(bytes.subarray(start)).toString("utf16le");
};

export const parseWslListVerbose = (text: string): WslDistro[] =>
  text
    .split(/\r?\n/u)
    .slice(1)
    .map(parseWslListLine)
    .filter((distro): distro is WslDistro => distro !== null);

export const wslBashLcArgv = (distro: string, script: string): string[] => [
  "-d",
  distro,
  "--",
  "bash",
  "-lc",
  script,
];

export const wslBashScriptArgv = (distro: string, script: string): string[] =>
  wslBashLcArgv(distro, `printf %s ${Buffer.from(script).toString("base64")} | base64 -d | bash`);

export const bashSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const shellJoin = (program: string, args: string[]): string =>
  [program, ...args].map(bashSingleQuote).join(" ");

export const wslRunnerArgv = (distro: string, command: CommandSpec): string[] =>
  wslBashLcArgv(
    distro,
    `${WSL_USER_CLI_PATH_SETUP}; exec ${shellJoin(command.program, command.args)}`,
  );

export const wslKillArgv = (distro: string): string[] =>
  wslBashScriptArgv(
    distro,
    'pidfile="$HOME/.aop/desktop-sidecar.pid"; pid=$(cat "$pidfile" 2>/dev/null || true); case "$pid" in (*[!0-9]*|\'\') ;; (*) exe=$(readlink "/proc/$pid/exe" 2>/dev/null || true); case "$exe" in ("$HOME/.aop/desktop-runtime/"*/aop) kill -TERM "$pid" 2>/dev/null || true ;; esac ;; esac; rm -f "$pidfile"',
  );

export const parseExecHost = (value: string): ExecHostMode => {
  const trimmed = value.trim();
  return trimmed.startsWith("wsl:") && trimmed.length > 4
    ? { kind: "wsl", distro: trimmed.slice(4) }
    : { kind: "native" };
};

export const formatExecHost = (mode: ExecHostMode): string =>
  mode.kind === "wsl" ? `wsl:${mode.distro}` : "native";

export const resolveWindowsExecHost = (
  current: ExecHostMode,
  distros: WslDistro[],
): ExecHostMode | null => {
  if (current.kind === "wsl" && distros.some((distro) => distro.name === current.distro)) {
    return current;
  }
  const selected = distros.find((distro) => distro.isDefault) ?? distros[0];
  return selected ? { kind: "wsl", distro: selected.name } : null;
};

export const execHostConfigPath = (
  platform: HostPlatform,
  home = process.env.HOME,
  userProfile = process.env.USERPROFILE,
): string | null => {
  const base = platform === "windows" ? (userProfile ?? home) : home;
  return base ? join(base, ".aop", "exec-host") : null;
};

export const loadExecHost = async (): Promise<ExecHostMode> => {
  if (process.env.AOP_EXEC_HOST?.trim()) return parseExecHost(process.env.AOP_EXEC_HOST);
  const path = execHostConfigPath(currentPlatform());
  if (!path) return { kind: "native" };
  try {
    return parseExecHost(await readFile(path, "utf8"));
  } catch {
    return { kind: "native" };
  }
};

export const saveExecHost = async (mode: ExecHostMode): Promise<void> => {
  const path = execHostConfigPath(currentPlatform());
  if (!path) throw new Error("Could not resolve the AOP home directory.");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatExecHost(mode));
};

export const listWslDistros = async (): Promise<WslDistro[]> => {
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["--list", "--verbose"], {
      encoding: "buffer",
      env: { ...process.env, WSL_UTF8: "1" },
      windowsHide: true,
    });
    return parseWslListVerbose(decodeWslOutput(stdout));
  } catch (error) {
    throw new Error("WSL is not installed or wsl.exe is unavailable.", { cause: error });
  }
};

export const listDesktopWslDistros = (
  platform: HostPlatform,
  list: () => Promise<WslDistro[]> = listWslDistros,
): Promise<WslDistro[]> => (platform === "windows" ? list() : Promise.resolve([]));

export const createWslCommandRunner = (distro: string): CommandRunner => ({
  run: async (command) => runCommand("wsl.exe", wslRunnerArgv(distro, command), {}),
});

const parseWslListLine = (line: string): WslDistro | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const isDefault = trimmed.startsWith("*");
  const tokens = trimmed.replace(/^\*/u, "").trim().split(/\s+/u);
  if (tokens.length < 3) return null;
  const name = tokens[0] ?? "";
  const version = Number(tokens.at(-1));
  if (
    version !== 2 ||
    name.toLowerCase() === "docker-desktop" ||
    name.toLowerCase() === "docker-desktop-data"
  ) {
    return null;
  }
  return {
    name,
    isDefault,
    running: tokens.at(-2)?.toLowerCase() === "running",
    version,
  };
};

const runCommand = async (
  program: string,
  args: string[],
  env: Record<string, string>,
): Promise<CommandOutput> => {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: typeof failure.code === "number" ? failure.code : 127,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
};
