#!/usr/bin/env bun

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { type UninstallDependencies, uninstallFromSource } from "./source-uninstall";
import {
  createTerminalProgress,
  silentTerminalProgress,
  type TerminalProgress,
} from "./terminal-progress";

export type SupportedPlatform = "darwin" | "linux";

type Command = string[];

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export type InstallDependencies = {
  chmod: typeof chmod;
  mkdir: typeof mkdir;
  run: (command: Command, options?: RunOptions) => Promise<void>;
  writeFile: typeof writeFile;
};

type ServiceTemplateOptions = {
  bunPath: string;
  dashboardStaticPath: string;
  logPath: string;
  localServerPort: string;
  localServerUrl: string;
  serviceName: string;
  workspaceDir: string;
};

type InstallOptions = {
  bunPath?: string;
  dependencies?: Partial<InstallDependencies>;
  homeDir?: string;
  platform?: SupportedPlatform;
  progress?: TerminalProgress;
  /** Stop/remove any existing install before rebuilding. Defaults to true. */
  refresh?: boolean;
  uninstall?: typeof uninstallFromSource;
  uninstallDependencies?: Partial<UninstallDependencies>;
  workspaceDir?: string;
};

type InstallerArgs = {
  mode: "help" | "install";
};

const LAUNCHD_SERVICE_NAME = "com.aop.local-server";
const SYSTEMD_SERVICE_NAME = "aop-local-server";
const DEFAULT_LOCAL_SERVER_PORT = "25150";
const DEFAULT_LOCAL_SERVER_URL = `http://aop.localhost:${DEFAULT_LOCAL_SERVER_PORT}`;
const SERVICE_PATH_FALLBACKS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] as const;
const HOSTED_LICENSE_ENV_KEYS = [
  "AOP_LICENSE_SERVER_URL",
  "AOP_CHECKOUT_PRO_URL",
  "AOP_CHECKOUT_TEAM_URL",
] as const;
const INSTALL_USAGE = `Usage: ./install

Installs or reinstalls AOP from source for the current user:
- stops and removes any existing local-server user service
- bun install --ignore-scripts
- bun link
- bun run build
- local-server user service on macOS/Linux
`;

const buildServiceEnvironment = ({
  bunPath,
  dashboardStaticPath,
  localServerPort,
  localServerUrl,
  logPath,
}: Pick<
  ServiceTemplateOptions,
  "bunPath" | "dashboardStaticPath" | "localServerPort" | "localServerUrl" | "logPath"
>): Record<string, string> => ({
  AOP_LOCAL_SERVER_PORT: localServerPort,
  AOP_LOCAL_SERVER_URL: localServerUrl,
  AOP_LOG_DIR: dirname(logPath),
  DASHBOARD_STATIC_PATH: dashboardStaticPath,
  ...resolveHostedLicenseEnvironment(),
  NODE_ENV: "production",
  PATH: buildServicePath(bunPath),
});

const buildServicePath = (bunPath: string): string => {
  const inheritedPath = process.env.PATH?.split(delimiter).filter(Boolean) ?? [];
  return [...new Set([dirname(bunPath), ...inheritedPath, ...SERVICE_PATH_FALLBACKS])].join(
    delimiter,
  );
};

const resolveHostedLicenseEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    HOSTED_LICENSE_ENV_KEYS.flatMap((key) => {
      const value = process.env[key]?.trim();
      return value ? [[key, value]] : [];
    }),
  );

const renderLaunchdEnvironmentVariables = (environment: Record<string, string>): string =>
  Object.entries(environment)
    .map(([key, value]) => `    <key>${key}</key>\n    <string>${value}</string>`)
    .join("\n");

const renderSystemdEnvironmentVariables = (environment: Record<string, string>): string =>
  Object.entries(environment)
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join("\n");

export const buildLaunchdPlist = ({
  bunPath,
  dashboardStaticPath,
  logPath,
  localServerPort,
  localServerUrl,
  serviceName,
  workspaceDir,
}: ServiceTemplateOptions): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceName}</string>
  <key>WorkingDirectory</key>
  <string>${workspaceDir}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>apps/local-server/src/run.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${renderLaunchdEnvironmentVariables(
  buildServiceEnvironment({
    bunPath,
    dashboardStaticPath,
    localServerPort,
    localServerUrl,
    logPath,
  }),
)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

export const buildSystemdUnit = ({
  bunPath,
  dashboardStaticPath,
  logPath,
  localServerPort,
  localServerUrl,
  serviceName,
  workspaceDir,
}: ServiceTemplateOptions): string => `[Unit]
Description=AOP Local Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${workspaceDir}
ExecStart=${bunPath} run apps/local-server/src/run.ts
${renderSystemdEnvironmentVariables(
  buildServiceEnvironment({
    bunPath,
    dashboardStaticPath,
    localServerPort,
    localServerUrl,
    logPath,
  }),
)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
# ${serviceName}
`;

type InstallRuntimeConfig = {
  bunPath: string;
  dashboardStaticPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  localServerPort: string;
  localServerUrl: string;
  logDir: string;
  logPath: string;
  progress: TerminalProgress;
  workspaceDir: string;
};

const runSourceInstallBuild = async (config: InstallRuntimeConfig): Promise<void> => {
  await config.progress.runStep("Preparing log directory", () =>
    config.dependencies.mkdir(config.logDir, { recursive: true }),
  );
  await config.progress.runStep(
    "Installing dependencies",
    () =>
      config.dependencies.run(["bun", "install", "--ignore-scripts"], {
        cwd: config.workspaceDir,
      }),
    { verbose: true },
  );
  await config.progress.runStep("Linking CLI globally", () =>
    config.dependencies.run(["bun", "link"], { cwd: config.workspaceDir }),
  );
  await config.progress.runStep("Installing CLI shim", () =>
    installCliShim({
      bunPath: config.bunPath,
      dependencies: config.dependencies,
      homeDir: config.homeDir,
      workspaceDir: config.workspaceDir,
    }),
  );
  await config.progress.runStep(
    "Building AOP",
    () => config.dependencies.run(["bun", "run", "build"], { cwd: config.workspaceDir }),
    { verbose: true },
  );
};

const startInstalledLocalServer = async (
  platform: SupportedPlatform,
  config: InstallRuntimeConfig,
): Promise<void> => {
  const serviceInput = {
    bunPath: config.bunPath,
    dashboardStaticPath: config.dashboardStaticPath,
    dependencies: config.dependencies,
    homeDir: config.homeDir,
    localServerPort: config.localServerPort,
    localServerUrl: config.localServerUrl,
    logPath: config.logPath,
    workspaceDir: config.workspaceDir,
  };

  await config.progress.runStep("Starting local server", () =>
    platform === "darwin" ? installLaunchAgent(serviceInput) : installSystemdUnit(serviceInput),
  );
};

export const installFromSource = async (options: InstallOptions = {}): Promise<void> => {
  const platform = options.platform ?? detectPlatform();
  const workspaceDir = options.workspaceDir ?? resolve(import.meta.dirname, "..");
  const homeDir = options.homeDir ?? homedir();
  const bunPath = options.bunPath ?? process.execPath;
  const dependencies = createDependencies(options.dependencies);
  const refresh = options.refresh ?? true;
  const progress = options.progress ?? createTerminalProgress();

  if (refresh) {
    const uninstall = options.uninstall ?? uninstallFromSource;
    await progress.runStep("Refreshing previous install", () =>
      uninstall({
        dependencies: options.uninstallDependencies,
        homeDir,
        platform,
        progress: silentTerminalProgress,
        workspaceDir,
      }),
    );
  }

  const config: InstallRuntimeConfig = {
    bunPath,
    dashboardStaticPath: join(workspaceDir, "apps", "dashboard", "dist"),
    dependencies,
    homeDir,
    localServerPort: process.env.AOP_LOCAL_SERVER_PORT ?? DEFAULT_LOCAL_SERVER_PORT,
    localServerUrl: process.env.AOP_LOCAL_SERVER_URL ?? DEFAULT_LOCAL_SERVER_URL,
    logDir: join(homeDir, ".aop", "logs"),
    logPath: join(homeDir, ".aop", "logs", "local-server.log"),
    progress,
    workspaceDir,
  };

  await runSourceInstallBuild(config);
  await startInstalledLocalServer(platform, config);
};

export const parseInstallerArgs = (args: string[]): InstallerArgs => {
  if (args.length === 0) {
    return { mode: "install" };
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { mode: "help" };
  }

  throw new Error(`Unknown argument "${args[0]}"`);
};

export const buildInstallSuccessMessage = (
  dashboardUrl = process.env.AOP_LOCAL_SERVER_URL ?? DEFAULT_LOCAL_SERVER_URL,
): string =>
  `${[
    "AOP source install complete.",
    "Any previous install was refreshed, dependencies were rebuilt, and the local server is running as a user service.",
    "The built dashboard is served from it, and the `aop` command is now linked globally.",
    `Dashboard: ${dashboardUrl}`,
    "Open that URL in your existing browser tab, or set AOP_OPEN_DASHBOARD=1 before install to launch one automatically.",
  ].join("\n")}\n`;

export const buildOpenBrowserCommand = (
  url: string,
  platform: SupportedPlatform,
): Command | null => {
  if (platform === "darwin") {
    return ["open", url];
  }

  if (platform === "linux") {
    return ["xdg-open", url];
  }

  return null;
};

export const openDashboardInBrowser = async (
  dashboardUrl = process.env.AOP_LOCAL_SERVER_URL ?? DEFAULT_LOCAL_SERVER_URL,
  options: {
    platform?: SupportedPlatform;
    run?: InstallDependencies["run"];
  } = {},
): Promise<void> => {
  if (process.env.CI === "true" || process.env.AOP_SKIP_BROWSER_OPEN === "1") {
    return;
  }

  const platform = options.platform ?? detectPlatform();
  const command = buildOpenBrowserCommand(dashboardUrl, platform);
  if (!command) {
    return;
  }

  const run = options.run ?? runCommand;
  await run(command, { allowFailure: true });
};

export const runSourceInstall = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseInstallerArgs(args);
  if (parsed.mode === "help") {
    process.stdout.write(INSTALL_USAGE);
    return;
  }

  const dashboardUrl = process.env.AOP_LOCAL_SERVER_URL ?? DEFAULT_LOCAL_SERVER_URL;
  const progress = createTerminalProgress();
  progress.banner("Installing AOP from source…");

  await installFromSource({ progress });
  process.stdout.write(`\n${buildInstallSuccessMessage(dashboardUrl)}`);
  if (process.env.AOP_OPEN_DASHBOARD === "1") {
    await openDashboardInBrowser(dashboardUrl);
  }
};

const installCliShim = async ({
  bunPath,
  dependencies,
  homeDir,
  workspaceDir,
}: {
  bunPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  workspaceDir: string;
}): Promise<void> => {
  const shimPath = join(resolveBunGlobalBinDir(homeDir), "aop");
  await dependencies.mkdir(dirname(shimPath), { recursive: true });
  await rm(shimPath, { force: true });
  await dependencies.writeFile(shimPath, buildCliShim({ bunPath, workspaceDir }));
  await dependencies.chmod(shimPath, 0o755);
};

const resolveBunGlobalBinDir = (homeDir: string): string => {
  const bunInstallDir = process.env.BUN_INSTALL?.trim();
  return bunInstallDir ? join(bunInstallDir, "bin") : join(homeDir, ".bun", "bin");
};

const buildCliShim = ({
  bunPath,
  workspaceDir,
}: {
  bunPath: string;
  workspaceDir: string;
}): string => {
  const cliEntryPath = shellQuote(join(workspaceDir, "apps", "cli", "src", "main.ts"));

  return [
    "#!/bin/sh",
    `if [ -x ${shellQuote(bunPath)} ]; then`,
    `  exec ${shellQuote(bunPath)} ${cliEntryPath} "$@"`,
    "fi",
    "if command -v bun >/dev/null 2>&1; then",
    `  exec bun ${cliEntryPath} "$@"`,
    "fi",
    "if command -v npx >/dev/null 2>&1; then",
    `  exec npx --yes bun ${cliEntryPath} "$@"`,
    "fi",
    'echo "AOP CLI requires bun or npx on PATH." >&2',
    "exit 127",
    "",
  ].join("\n");
};

const shellQuote = (value: string): string =>
  `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`")}"`;

const installLaunchAgent = async ({
  bunPath,
  dashboardStaticPath,
  dependencies,
  homeDir,
  localServerPort,
  localServerUrl,
  logPath,
  workspaceDir,
}: {
  bunPath: string;
  dashboardStaticPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  localServerPort: string;
  localServerUrl: string;
  logPath: string;
  workspaceDir: string;
}): Promise<void> => {
  const agentsDir = join(homeDir, "Library", "LaunchAgents");
  const plistPath = join(agentsDir, `${LAUNCHD_SERVICE_NAME}.plist`);

  await dependencies.mkdir(agentsDir, { recursive: true });
  await dependencies.writeFile(
    plistPath,
    buildLaunchdPlist({
      bunPath,
      dashboardStaticPath,
      logPath,
      localServerPort,
      localServerUrl,
      serviceName: LAUNCHD_SERVICE_NAME,
      workspaceDir,
    }),
  );
  await dependencies.chmod(plistPath, 0o644);
  await dependencies.run(["launchctl", "unload", plistPath], { allowFailure: true });
  await dependencies.run(["launchctl", "load", "-w", plistPath]);
};

const installSystemdUnit = async ({
  bunPath,
  dashboardStaticPath,
  dependencies,
  homeDir,
  localServerPort,
  localServerUrl,
  logPath,
  workspaceDir,
}: {
  bunPath: string;
  dashboardStaticPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  localServerPort: string;
  localServerUrl: string;
  logPath: string;
  workspaceDir: string;
}): Promise<void> => {
  const systemdDir = join(homeDir, ".config", "systemd", "user");
  const unitPath = join(systemdDir, `${SYSTEMD_SERVICE_NAME}.service`);

  await dependencies.mkdir(systemdDir, { recursive: true });
  await dependencies.writeFile(
    unitPath,
    buildSystemdUnit({
      bunPath,
      dashboardStaticPath,
      logPath,
      localServerPort,
      localServerUrl,
      serviceName: SYSTEMD_SERVICE_NAME,
      workspaceDir,
    }),
  );
  await dependencies.run(["systemctl", "--user", "daemon-reload"]);
  await dependencies.run([
    "systemctl",
    "--user",
    "enable",
    "--now",
    `${SYSTEMD_SERVICE_NAME}.service`,
  ]);
};

const createDependencies = (
  dependencies: Partial<InstallDependencies> = {},
): InstallDependencies => ({
  chmod,
  mkdir,
  run: runCommand,
  writeFile,
  ...dependencies,
});

const detectPlatform = (): SupportedPlatform => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(
    `Unsupported platform "${process.platform}". Source install supports macOS and Linux.`,
  );
};

const runCommand = async (command: Command, options: RunOptions = {}): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  if (exitCode === 0 || options.allowFailure) {
    return;
  }

  throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
};

if (import.meta.main) {
  await runSourceInstall();
}
