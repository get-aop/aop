#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, platform as osPlatform } from "node:os";
import { basename, join } from "node:path";

const DEFAULT_SERVER_PORT = 25250;
const DEFAULT_DASHBOARD_PORT = 25260;
const SERVICE_LABEL = "com.aop.local-dev";
const DEFAULT_LICENSE_SERVER_URL = "https://license.getaop.com";
const PORT_FLAGS = {
  "--dashboard-port": "dashboardPort",
  "--server-port": "serverPort",
} as const;

export type LocalAopCommand = "start" | "stop" | "status" | "logs" | "help";
type PortOptionName = (typeof PORT_FLAGS)[keyof typeof PORT_FLAGS];

export interface LocalAopOptions {
  command: LocalAopCommand;
  dashboardPort: number;
  serverPort: number;
  workspaceDir?: string;
}

export interface LocalAopPaths {
  aopHome: string;
  logPath: string;
}

export interface LocalAopDependencies {
  ensureDir: (path: string) => Promise<void>;
  getWorkspaceDir: () => Promise<string>;
  run: (command: string[]) => Promise<void>;
  truncateFile: (path: string) => Promise<void>;
  waitForHealth: (url: string) => Promise<void>;
  write: (message: string) => void;
}

interface LocalAopInput {
  args: string[];
  dependencies?: Partial<LocalAopDependencies>;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

interface StartCommandInput {
  aopHome: string;
  bunPath: string;
  dashboardPort: number;
  licenseServerUrl: string;
  serverPort: number;
  workspaceDir: string;
}

export const parseLocalAopArgs = (args: string[]): LocalAopOptions => {
  const [first, ...remaining] = args;
  if (!first || first === "--help" || first === "-h") {
    return buildOptions("help");
  }

  if (!["start", "stop", "status", "logs"].includes(first)) {
    throw new Error(`Unknown command "${first}"`);
  }

  return parseOptions(first as LocalAopCommand, remaining);
};

const buildOptions = (
  command: LocalAopCommand,
  overrides: Partial<Omit<LocalAopOptions, "command">> = {},
): LocalAopOptions => ({
  command,
  dashboardPort: overrides.dashboardPort ?? DEFAULT_DASHBOARD_PORT,
  serverPort: overrides.serverPort ?? DEFAULT_SERVER_PORT,
});

const parseOptions = (command: LocalAopCommand, args: string[]): LocalAopOptions => {
  const options = buildOptions(command);

  for (let index = 0; index < args.length; ) {
    index = parseOptionAt(args, index, options);
  }

  return options;
};

export const getLocalAopPaths = (input: {
  homeDir: string;
  workspaceDir: string;
}): LocalAopPaths => {
  const hash = createHash("sha1").update(input.workspaceDir).digest("hex").slice(0, 6);
  const aopHome = join(input.homeDir, ".aop-local-dev", `${basename(input.workspaceDir)}-${hash}`);
  return {
    aopHome,
    logPath: join(aopHome, "logs", "dev.log"),
  };
};

export const buildLocalAopStartCommand = (input: StartCommandInput): string => {
  const serverUrl = `http://127.0.0.1:${input.serverPort}`;
  const dashboardUrl = `http://127.0.0.1:${input.dashboardPort}`;
  const logDir = join(input.aopHome, "logs");
  const tmpDir = join(input.aopHome, "tmp");
  const dbPath = join(input.aopHome, "aop.sqlite");
  const pathValue = [
    join(input.bunPath, ".."),
    join(input.aopHome, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");

  const envAssignments = [
    `AOP_HOME=${shellQuote(input.aopHome)}`,
    `AOP_DB_PATH=${shellQuote(dbPath)}`,
    `AOP_LOG_DIR=${shellQuote(logDir)}`,
    `TMPDIR=${shellQuote(tmpDir)}`,
    `AOP_LOCAL_SERVER_PORT=${input.serverPort}`,
    `AOP_LOCAL_SERVER_URL=${shellQuote(serverUrl)}`,
    `AOP_DASHBOARD_PORT=${input.dashboardPort}`,
    `AOP_DASHBOARD_URL=${shellQuote(dashboardUrl)}`,
    `AOP_LICENSE_SERVER_URL=${shellQuote(input.licenseServerUrl)}`,
    `AOP_TEST_MODE=${shellQuote("false")}`,
    `PATH=${shellQuote(pathValue)}`,
  ].join(" ");

  return [
    `cd ${shellQuote(input.workspaceDir)}`,
    `exec /usr/bin/env ${envAssignments} ${shellQuote(input.bunPath)} run dev`,
  ].join(" && ");
};

export const localAop = async (input: LocalAopInput): Promise<void> => {
  const options = parseLocalAopArgs(input.args);
  const platform = input.platform ?? osPlatform();
  const homeDir = input.homeDir ?? homedir();
  const dependencies = buildDependencies(input.dependencies);

  if (options.command === "help") {
    printHelp();
    return;
  }

  if (options.command === "stop") {
    await stopLocalAop({ dependencies, platform });
    return;
  }

  if (options.command === "status") {
    await statusLocalAop({ dependencies, platform });
    return;
  }

  const workspaceDir = options.workspaceDir ?? (await dependencies.getWorkspaceDir());
  const paths = getLocalAopPaths({ homeDir, workspaceDir });

  if (options.command === "start") {
    await startLocalAop({ dependencies, options, paths, platform, workspaceDir });
    return;
  }

  await logsLocalAop(paths.logPath, dependencies);
};

const startLocalAop = async (input: {
  dependencies: LocalAopDependencies;
  options: LocalAopOptions;
  paths: LocalAopPaths;
  platform: NodeJS.Platform;
  workspaceDir: string;
}): Promise<void> => {
  const { dependencies, options, paths, platform, workspaceDir } = input;

  if (platform !== "darwin") {
    throw new Error("local:aop currently supports macOS launchd only");
  }

  await dependencies.ensureDir(join(paths.aopHome, "logs"));
  await dependencies.ensureDir(join(paths.aopHome, "tmp"));
  await dependencies.truncateFile(paths.logPath);

  await stopLocalAop({ dependencies, platform });
  await killPort(dependencies, options.serverPort);
  await killPort(dependencies, options.dashboardPort);

  const command = buildLocalAopStartCommand({
    aopHome: paths.aopHome,
    bunPath: Bun.which("bun") ?? "",
    dashboardPort: options.dashboardPort,
    licenseServerUrl: process.env.AOP_LICENSE_SERVER_URL ?? DEFAULT_LICENSE_SERVER_URL,
    serverPort: options.serverPort,
    workspaceDir,
  });

  await dependencies.run([
    "launchctl",
    "submit",
    "-l",
    SERVICE_LABEL,
    "-o",
    paths.logPath,
    "-e",
    paths.logPath,
    "--",
    "/bin/zsh",
    "-lc",
    command,
  ]);

  await dependencies.waitForHealth(`http://127.0.0.1:${options.serverPort}/api/health`);

  dependencies.write(`AOP local dev started from ${workspaceDir}\n`);
  dependencies.write(`Dashboard: http://127.0.0.1:${options.dashboardPort}\n`);
  dependencies.write(`API: http://127.0.0.1:${options.serverPort}\n`);
  dependencies.write(`AOP_HOME: ${paths.aopHome}\n`);
  dependencies.write(`Logs: ${paths.logPath}\n`);
};

const stopLocalAop = async (input: {
  dependencies: LocalAopDependencies;
  platform: NodeJS.Platform;
}): Promise<void> => {
  if (input.platform !== "darwin") {
    throw new Error("local:aop currently supports macOS launchd only");
  }
  await input.dependencies.run(["launchctl", "remove", SERVICE_LABEL]);
};

const statusLocalAop = async (input: {
  dependencies: LocalAopDependencies;
  platform: NodeJS.Platform;
}): Promise<void> => {
  if (input.platform !== "darwin") {
    throw new Error("local:aop currently supports macOS launchd only");
  }
  await input.dependencies.run([
    "launchctl",
    "print",
    `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`,
  ]);
};

const logsLocalAop = async (logPath: string, dependencies: LocalAopDependencies): Promise<void> => {
  await dependencies.run(["tail", "-f", logPath]);
};

const buildDependencies = (
  overrides: Partial<LocalAopDependencies> = {},
): LocalAopDependencies => ({
  ensureDir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  getWorkspaceDir: async () => {
    const result = await Bun.$`git rev-parse --show-toplevel`.quiet().text();
    return result.trim();
  },
  run: async (command) => {
    const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    const exitCode = await proc.exited;
    if (exitCode !== 0 && !isAllowedFailure(command)) {
      throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
    }
  },
  truncateFile: async (path) => {
    await writeFile(path, "");
  },
  waitForHealth,
  write: (message) => {
    process.stdout.write(message);
  },
  ...overrides,
});

const waitForHealth = async (url: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until startup completes.
    }
    await Bun.sleep(250);
  }
  throw new Error(`AOP local server did not become healthy at ${url}`);
};

const killPort = async (dependencies: LocalAopDependencies, port: number): Promise<void> => {
  await dependencies.run(["sh", "-lc", `lsof -ti tcp:${port} | xargs kill -9`]);
};

const isAllowedFailure = (command: string[]): boolean => {
  if (command[0] === "launchctl" && command[1] === "remove") return true;
  if (command[0] === "sh" && command[2]?.startsWith("lsof -ti tcp:")) return true;
  return false;
};

const parsePort = (value: string | undefined, flag: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${flag} must be a valid TCP port`);
  }
  return port;
};

const parseOptionAt = (args: string[], index: number, options: LocalAopOptions): number => {
  const arg = args[index];
  if (!arg) return index + 1;

  const inlineMatch = arg.match(/^(--server-port|--dashboard-port)=(.+)$/);
  if (inlineMatch) {
    setPortOption(options, inlineMatch[1] as keyof typeof PORT_FLAGS, inlineMatch[2]);
    return index + 1;
  }

  const inlineWorkspace = arg.match(/^--workspace=(.+)$/);
  if (inlineWorkspace) {
    options.workspaceDir = parseWorkspaceDir(inlineWorkspace[1], "--workspace");
    return index + 1;
  }

  if (isPortFlag(arg)) {
    setPortOption(options, arg, args[index + 1]);
    return index + 2;
  }

  if (arg === "--workspace") {
    options.workspaceDir = parseWorkspaceDir(args[index + 1], "--workspace");
    return index + 2;
  }

  throw new Error(`Unknown argument "${arg}"`);
};

const isPortFlag = (arg: string): arg is keyof typeof PORT_FLAGS => Object.hasOwn(PORT_FLAGS, arg);

const setPortOption = (
  options: LocalAopOptions,
  flag: keyof typeof PORT_FLAGS,
  value: string | undefined,
): void => {
  options[PORT_FLAGS[flag] as PortOptionName] = parsePort(value, flag);
};

const parseWorkspaceDir = (value: string | undefined, flag: string): string => {
  const workspaceDir = value?.trim();
  if (!workspaceDir) {
    throw new Error(`${flag} must include a worktree path`);
  }
  return workspaceDir;
};

const shellQuote = (value: string): string => JSON.stringify(value);

const printHelp = (): void => {
  process.stdout.write(`Usage: bun run local:aop -- <command> [options]

Commands:
  start    Stop the local-dev service, kill the selected ports, then start from this worktree
  stop     Stop the local-dev service
  status   Print launchd status for the local-dev service
  logs     Tail the local-dev log

Options:
  --server-port <port>      API port (default: ${DEFAULT_SERVER_PORT})
  --dashboard-port <port>   dashboard port (default: ${DEFAULT_DASHBOARD_PORT})
  --workspace <path>        worktree to run (default: current git repository)
`);
};

if (import.meta.main) {
  localAop({ args: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
