import { execFile, spawn as spawnProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SidecarState } from "../../src/backend/types";
import { platformDetails } from "./platform";
import {
  buildNativeSidecarLaunchConfig,
  buildWslSidecarLaunchConfig,
  existingServerMatchesSidecarVersion,
  isValidRuntimeFingerprint,
  parseSidecarPorts,
  provisionManagedRuntimeArgv,
  releaseKnownWslRuntimeArgv,
  type SidecarLaunchConfig,
  sidecarFailureMessage,
  sidecarSpawnCommand,
} from "./sidecar";
import type { CommandOutput, HostPlatform } from "./types";
import type { ExecHostMode } from "./wsl";
import { wslBashLcArgv, wslKillArgv } from "./wsl";

const execFileAsync = promisify(execFile);

interface ManagedChild {
  pid?: number;
  kill: () => void;
  exited: Promise<unknown>;
}

interface SpawnOptions {
  env: Record<string, string>;
  windowsHide: boolean;
}

interface DesktopRuntimeOptions {
  platform: HostPlatform;
  version: string;
  resourcePath: (name: string) => string;
  env: Record<string, string | undefined>;
  loadExecHost: () => Promise<ExecHostMode>;
  isHealthy: (url: string) => Promise<boolean>;
  execute: (
    program: string,
    args: string[],
    env?: Record<string, string>,
  ) => Promise<CommandOutput>;
  spawn: (program: string, args: string[], options: SpawnOptions) => ManagedChild;
  mkdir: (path: string) => Promise<unknown>;
  readText: (path: string) => Promise<string>;
  wait: (milliseconds: number) => Promise<void>;
  readServerVersion?: (healthUrl: string) => Promise<string | null>;
}

export interface DesktopRuntime {
  start: () => Promise<SidecarState>;
  stop: () => Promise<void>;
  getState: () => SidecarState;
}

export const createDesktopRuntime = (options: DesktopRuntimeOptions): DesktopRuntime => {
  let child: ManagedChild | null = null;
  let launchConfig: SidecarLaunchConfig | null = null;
  let state: SidecarState = { status: "idle" };
  let starting: Promise<SidecarState> | null = null;

  const start = (): Promise<SidecarState> => {
    if (starting) return starting;
    starting = startSidecar().finally(() => {
      starting = null;
    });
    return starting;
  };

  const startSidecar = async (): Promise<SidecarState> => {
    const config = await buildLaunchConfig(options);
    launchConfig = config;
    state = { status: "starting", logPath: config.env.AOP_LOG_DIR };

    const preparedState = await prepareLaunch(options, config);
    if (preparedState) return updateState(preparedState);

    if (!child) {
      const spawnCommand = sidecarSpawnCommand(config);
      child = options.spawn(spawnCommand.program, spawnCommand.args, {
        env:
          config.mode.kind === "native"
            ? definedEnvironment({ ...options.env, ...config.env })
            : definedEnvironment(options.env),
        windowsHide: true,
      });
    }

    if (await waitUntilHealthy(options, config.healthUrl)) return updateState(readyState(config));
    return updateState(await startupFailureState(options, config));
  };

  const stop = async (): Promise<void> => {
    const activeChild = child;
    const config = launchConfig;
    child = null;
    launchConfig = null;
    if (!activeChild || !config) return;

    if (config.mode.kind === "wsl") {
      await options.execute("wsl.exe", wslKillArgv(config.mode.distro)).catch(() => undefined);
    } else if (options.platform === "windows" && activeChild.pid) {
      await options
        .execute("taskkill", ["/T", "/F", "/PID", String(activeChild.pid)])
        .catch(() => undefined);
    }
    activeChild.kill();
    await activeChild.exited.catch(() => undefined);
    state = { status: "idle" };
  };

  const updateState = (nextState: SidecarState): SidecarState => {
    state = nextState;
    return nextState;
  };

  return { start, stop, getState: () => state };
};

export const defaultLogDirFor = (
  platform: HostPlatform,
  env: Record<string, string | undefined>,
): string => {
  if (env.AOP_LOG_DIR) return env.AOP_LOG_DIR;
  const home = platform === "windows" ? (env.USERPROFILE ?? env.HOME) : env.HOME;
  if (!home) throw new Error("Could not resolve the AOP home directory.");
  return join(home, ".aop", "logs");
};

export const defaultDesktopRuntimeDependencies = (
  platform: HostPlatform,
  version: string,
  resourcePath: (name: string) => string,
  loadExecHost: () => Promise<ExecHostMode>,
): DesktopRuntimeOptions => ({
  platform,
  version,
  resourcePath,
  env: process.env,
  loadExecHost,
  isHealthy: checkHealth,
  execute: executeCommand,
  spawn: spawnChild,
  mkdir: (path) => mkdir(path, { recursive: true }),
  readText: (path) => readFile(path, "utf8"),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

const buildLaunchConfig = async (options: DesktopRuntimeOptions): Promise<SidecarLaunchConfig> => {
  const ports = parseSidecarPorts(
    options.env.AOP_DESKTOP_LOCAL_SERVER_PORT,
    options.env.AOP_DESKTOP_DASHBOARD_PORT,
  );
  const mode = await options.loadExecHost();
  if (mode.kind === "wsl") {
    return buildWslSidecarLaunchConfig(mode.distro, options.version, ports);
  }
  if (options.platform === "windows") {
    throw new Error("Select a WSL 2 distro before starting AOP Desktop.");
  }
  const logDir = defaultLogDirFor(options.platform, options.env);
  await options.mkdir(logDir);
  return buildNativeSidecarLaunchConfig(
    {
      executable:
        options.env.AOP_DESKTOP_SIDECAR_PATH ??
        options.resourcePath(platformDetails(options.platform).sidecarResourceName),
      logDir,
    },
    ports,
  );
};

const prepareLaunch = async (
  options: DesktopRuntimeOptions,
  config: SidecarLaunchConfig,
): Promise<SidecarState | null> =>
  config.mode.kind === "wsl"
    ? prepareWslLaunch(options, config, config.mode.distro)
    : prepareNativeLaunch(options, config);

const prepareWslLaunch = async (
  options: DesktopRuntimeOptions,
  config: SidecarLaunchConfig,
  distro: string,
): Promise<SidecarState | null> => {
  await releaseKnownWslRuntime(options, distro);
  await options.wait(600);
  if (await options.isHealthy(config.healthUrl)) {
    return {
      status: "failed",
      message: `Another process is using AOP port ${config.env.AOP_LOCAL_SERVER_PORT} inside WSL. Stop it and reopen AOP Desktop.`,
    };
  }
  await provisionManagedWslRuntime(options, distro);
  return null;
};

const prepareNativeLaunch = async (
  options: DesktopRuntimeOptions,
  config: SidecarLaunchConfig,
): Promise<SidecarState | null> => {
  if (!(await options.isHealthy(config.healthUrl))) return null;
  const sidecarVersion = await resolveSidecarVersion(options, config.program);
  const serverVersion = await (options.readServerVersion ?? readServerVersion)(config.healthUrl);
  if (serverVersion && existingServerMatchesSidecarVersion(serverVersion, sidecarVersion)) {
    return readyState(config);
  }
  await releaseKnownNativeRuntime(options, Number(config.env.AOP_LOCAL_SERVER_PORT));
  if (!(await options.isHealthy(config.healthUrl))) return null;
  return {
    status: "failed",
    logPath: config.env.AOP_LOG_DIR,
    message: "A different AOP server is already running on port 25150. Quit it and reopen AOP.",
  };
};

const waitUntilHealthy = async (
  options: DesktopRuntimeOptions,
  healthUrl: string,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await options.isHealthy(healthUrl)) return true;
    await options.wait(250);
  }
  return false;
};

const startupFailureState = async (
  options: DesktopRuntimeOptions,
  config: SidecarLaunchConfig,
): Promise<SidecarState> => ({
  status: "failed",
  logPath: config.env.AOP_LOG_DIR,
  message:
    config.mode.kind === "wsl"
      ? await wslFailureMessage(options, config)
      : "The AOP local server did not become healthy.",
});

const provisionManagedWslRuntime = async (
  options: DesktopRuntimeOptions,
  distro: string,
): Promise<void> => {
  const fingerprint = (
    await options.readText(options.resourcePath("desktop-runtime.sha256"))
  ).trim();
  if (!isValidRuntimeFingerprint(fingerprint)) {
    throw new Error("The bundled AOP runtime fingerprint is invalid.");
  }
  const result = await options.execute(
    "wsl.exe",
    provisionManagedRuntimeArgv(
      distro,
      options.version,
      options.resourcePath("aop-linux-x64"),
      options.resourcePath("runtime-assets.tar.gz"),
      fingerprint,
    ),
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not install the bundled AOP runtime inside WSL: ${failureMessage(result)}`,
    );
  }
};

const releaseKnownWslRuntime = async (
  options: DesktopRuntimeOptions,
  distro: string,
): Promise<void> => {
  await options.execute("wsl.exe", releaseKnownWslRuntimeArgv(distro)).catch(() => undefined);
};

const releaseKnownNativeRuntime = async (
  options: DesktopRuntimeOptions,
  port: number,
): Promise<void> => {
  if (process.platform === "darwin") {
    for (const service of ["com.aop.local-server", "com.getaop.local-server"]) {
      const home = options.env.HOME;
      if (home) {
        await options
          .execute("launchctl", [
            "unload",
            join(home, "Library", "LaunchAgents", `${service}.plist`),
          ])
          .catch(() => undefined);
      }
    }
  }
  const listeners = await options.execute("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"]);
  const pids = listeners.stdout.trim().split(/\s+/u).filter(Boolean);
  if (pids.length > 0) {
    await options.execute("kill", pids).catch(() => undefined);
    await options.wait(300);
    await options.execute("kill", ["-9", ...pids]).catch(() => undefined);
  }
  await options.wait(600);
};

const resolveSidecarVersion = async (
  options: DesktopRuntimeOptions,
  executable: string,
): Promise<string> => {
  const output = await options.execute(executable, ["--version"]);
  if (output.status !== 0) throw new Error("Bundled AOP sidecar did not report a version.");
  const version = output.stdout.split("/")[1]?.trim().split(/\s+/u)[0];
  if (!version) throw new Error("Bundled AOP sidecar version output was not recognized.");
  return version;
};

const wslFailureMessage = async (
  options: DesktopRuntimeOptions,
  config: SidecarLaunchConfig,
): Promise<string> => {
  if (config.mode.kind !== "wsl") return "The AOP local server did not become healthy.";
  const port = Number(config.env.AOP_LOCAL_SERVER_PORT || 25150);
  const result = await options.execute(
    "wsl.exe",
    wslBashLcArgv(
      config.mode.distro,
      `curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/api/health`,
    ),
  );
  return sidecarFailureMessage(
    result.status === 0 && result.stdout.startsWith("200")
      ? "localhost-forwarding-blocked"
      : "sidecar-never-started",
  );
};

const readyState = (config: SidecarLaunchConfig): SidecarState => ({
  status: "ready",
  dashboardUrl: config.dashboardUrl,
  logPath: config.env.AOP_LOG_DIR,
  message: "AOP is ready.",
});

const checkHealth = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.status === 200;
  } catch {
    return false;
  }
};

const readServerVersion = async (healthUrl: string): Promise<string | null> => {
  try {
    const response = await fetch(healthUrl.replace(/\/api\/health$/u, "/api/updates"), {
      signal: AbortSignal.timeout(500),
    });
    const body = (await response.json()) as { currentVersion?: unknown };
    return typeof body.currentVersion === "string" ? body.currentVersion : null;
  } catch {
    return null;
  }
};

const definedEnvironment = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const failureMessage = (output: CommandOutput): string =>
  output.stderr.trim() || output.stdout.trim() || `exit code ${output.status}`;

const executeCommand = async (
  program: string,
  args: string[],
  env: Record<string, string> = {},
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

const spawnChild = (program: string, args: string[], options: SpawnOptions): ManagedChild => {
  const child = spawnProcess(program, args, {
    env: options.env,
    stdio: "ignore",
    windowsHide: options.windowsHide,
  });
  return {
    pid: child.pid,
    kill: () => {
      child.kill();
    },
    exited: new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", resolve);
    }),
  };
};
