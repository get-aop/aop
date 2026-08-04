#!/usr/bin/env bun

// biome-ignore-all lint/suspicious/noConsole: CLI layer requires console output for user feedback

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { configureLogging, type LoggingOptions, type LogLevel } from "@aop/infra";
import cac, { type CAC } from "cac";
import {
  configGetCommand,
  configSetCommand,
  createTaskCommand,
  jiraConfigureCommand,
  jiraStatusCommand,
  linearConfigureCommand,
  linearConnectCommand,
  linearDisconnectCommand,
  linearStatusCommand,
  linearUnlockCommand,
  repoInitCommand,
  repoRemoveCommand,
  runTaskCommand,
  sessionWorkspaceResetCommand,
  sessionWorkspaceSetCommand,
  statusCommand,
  taskReadyCommand,
  taskRemoveCommand,
} from "./commands/index.ts";

declare const BUILD_VERSION: string;

type CommandHandlers = {
  configGetCommand: typeof configGetCommand;
  configSetCommand: typeof configSetCommand;
  createTaskCommand: typeof createTaskCommand;
  jiraConfigureCommand: typeof jiraConfigureCommand;
  jiraStatusCommand: typeof jiraStatusCommand;
  linearConfigureCommand: typeof linearConfigureCommand;
  linearConnectCommand: typeof linearConnectCommand;
  linearDisconnectCommand: typeof linearDisconnectCommand;
  linearStatusCommand: typeof linearStatusCommand;
  linearUnlockCommand: typeof linearUnlockCommand;
  repoInitCommand: typeof repoInitCommand;
  repoRemoveCommand: typeof repoRemoveCommand;
  runTaskCommand: typeof runTaskCommand;
  sessionWorkspaceResetCommand: typeof sessionWorkspaceResetCommand;
  sessionWorkspaceSetCommand: typeof sessionWorkspaceSetCommand;
  statusCommand: typeof statusCommand;
  taskReadyCommand: typeof taskReadyCommand;
  taskRemoveCommand: typeof taskRemoveCommand;
};

type LoggingDependencies = {
  mkdir: typeof mkdir;
  configureLogging: typeof configureLogging;
  now: () => Date;
};

type CliDependencies = {
  loadProjectEnv: typeof loadProjectEnv;
  setupLogging: typeof setupLogging;
  exit: (code: number) => never;
  error: (...args: unknown[]) => void;
};

const defaultCommandHandlers: CommandHandlers = {
  configGetCommand,
  configSetCommand,
  createTaskCommand,
  jiraConfigureCommand,
  jiraStatusCommand,
  linearConfigureCommand,
  linearConnectCommand,
  linearDisconnectCommand,
  linearStatusCommand,
  linearUnlockCommand,
  repoInitCommand,
  repoRemoveCommand,
  runTaskCommand,
  sessionWorkspaceResetCommand,
  sessionWorkspaceSetCommand,
  statusCommand,
  taskReadyCommand,
  taskRemoveCommand,
};

export const CLI_VERSION = readCliPackageVersion();

export const parseEnvFile = (content: string): Map<string, string> => {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    vars.set(key, value);
  }
  return vars;
};

/** Load .env from the AOP project root, resolved relative to CLI source files */
export const loadProjectEnv = async (): Promise<void> => {
  const projectRoot = resolve(import.meta.dirname, "..", "..", "..");
  const envPath = resolve(projectRoot, ".env");
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) return;

  const content = await envFile.text();
  const vars = parseEnvFile(content);
  for (const [key, value] of vars) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

export const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
};

export const setupLogging = async (
  dependencies: Partial<LoggingDependencies> = {},
): Promise<void> => {
  const runtime: LoggingDependencies = {
    mkdir,
    configureLogging,
    now: () => new Date(),
    ...dependencies,
  };

  const logDir = process.env.AOP_LOG_DIR;
  const logLevel = (process.env.AOP_LOG_LEVEL as LogLevel) || "info";
  const options: LoggingOptions = { level: logLevel, format: "pretty", serviceName: "cli" };

  if (logDir) {
    await runtime.mkdir(logDir, { recursive: true });
    const timestamp = formatTimestamp(runtime.now());
    options.sinks = {
      console: true,
      files: [
        { path: `${logDir}/aop-${timestamp}.jsonl`, format: "json" },
        { path: `${logDir}/aop-${timestamp}.log`, format: "pretty" },
      ],
    };
  }

  await runtime.configureLogging(options);
};

export const registerCommands = (
  cli: CAC,
  commands: CommandHandlers = defaultCommandHandlers,
): void => {
  cli
    .command("status [taskId]", "Show status")
    .option("--json", "Output as JSON")
    .action((taskId, options) => commands.statusCommand(taskId, { json: options.json }));

  cli
    .command("linear:configure", "Save Linear OAuth settings")
    .option("--client-id <clientId>", "Linear OAuth client ID")
    .option("--callback-url <callbackUrl>", "Linear OAuth callback URL")
    .action((options) =>
      commands.linearConfigureCommand({
        clientId: options.clientId,
        callbackUrl: options.callbackUrl,
      }),
    );

  cli
    .command("linear:connect", "Start the Linear OAuth flow")
    .action(() => commands.linearConnectCommand());

  cli
    .command("linear:status", "Show Linear connection status")
    .action(() => commands.linearStatusCommand());

  cli
    .command("linear:unlock", "Unlock the local Linear token store")
    .action(() => commands.linearUnlockCommand());

  cli
    .command("linear:disconnect", "Disconnect the local Linear token store")
    .action(() => commands.linearDisconnectCommand());

  cli
    .command("jira:configure", "Save Jira Cloud settings")
    .option("--site-url <siteUrl>", "Jira Cloud site URL")
    .option("--email <email>", "Jira Cloud account email")
    .option("--api-token <apiToken>", "Jira Cloud API token")
    .action((options) =>
      commands.jiraConfigureCommand({
        siteUrl: options.siteUrl,
        email: options.email,
        apiToken: options.apiToken,
      }),
    );

  cli
    .command("jira:status", "Show Jira connection status")
    .action(() => commands.jiraStatusCommand());

  cli
    .command("repo:init [path]", "Register repository")
    .action((path) => commands.repoInitCommand(path));

  cli
    .command("repo:remove [path]", "Unregister repository")
    .option("--force", "Abort working tasks")
    .action((path, options) => commands.repoRemoveCommand(path, { force: options.force }));

  cli
    .command("task:ready <identifier>", "Mark task as READY")
    .option("--resume [stepId]", "Retry from last step, or a specific step")
    .action((identifier, options) =>
      commands.taskReadyCommand(identifier, {
        retryFromStep: options.resume === true ? "last" : options.resume || undefined,
      }),
    );

  cli
    .command("task:remove <identifier>", "Remove task")
    .option("--force", "Abort working task")
    .action((identifier, options) =>
      commands.taskRemoveCommand(identifier, { force: options.force }),
    );

  cli
    .command("create-task [description]", "Deprecated: use /task create in AOP Sessions")
    .option("--debug", "Enable debug mode")
    .option("--raw", "Show raw output")
    .action(async (description, options) => {
      await commands.createTaskCommand(description, {
        debug: options.debug,
        raw: options.raw,
      });
    });

  cli
    .command("run-task <taskName>", "Create task documents for a task name")
    .action((taskName) => commands.runTaskCommand(taskName));

  cli
    .command(
      "session <resource> <action> [...values]",
      "Manage chat sessions (workspace set <sessionId> <path> | workspace reset <sessionId>)",
    )
    .action((resource: string, action: string, values: string[]) => {
      if (resource === "workspace" && action === "set" && values.length === 2) {
        return commands.sessionWorkspaceSetCommand(values[0] ?? "", values[1] ?? "");
      }
      if (resource === "workspace" && action === "reset" && values.length === 1) {
        return commands.sessionWorkspaceResetCommand(values[0] ?? "");
      }
      throw new Error(
        "Usage: aop session workspace set <sessionId> <path> | aop session workspace reset <sessionId>",
      );
    });

  cli
    .command("config:get [key]", "Get config value(s)")
    .action((key) => commands.configGetCommand(key));

  cli
    .command("config:set <key> <value>", "Set config value")
    .action((key, value) => commands.configSetCommand(key, value));
};

export const createCli = (
  dependencies: Partial<Pick<CliDependencies, "exit" | "error">> = {},
): CAC => {
  const runtime = {
    exit: process.exit as CliDependencies["exit"],
    error: (...args: unknown[]) => console.error(...args),
    ...dependencies,
  };

  const cli = cac("aop");
  registerCommands(cli);
  cli.help();
  cli.version(CLI_VERSION);

  cli.addEventListener("command:*", () => {
    runtime.error(`Unknown command: ${cli.args.join(" ")}`);
    runtime.error(`Run "aop --help" for usage`);
    runtime.exit(1);
  });

  return cli;
};

export const runCli = async (
  cli: CAC,
  dependencies: Partial<CliDependencies> = {},
): Promise<void> => {
  const runtime: CliDependencies = {
    loadProjectEnv,
    setupLogging,
    exit: process.exit as CliDependencies["exit"],
    error: (...args: unknown[]) => console.error(...args),
    ...dependencies,
  };

  await runtime.loadProjectEnv();
  await runtime.setupLogging();

  try {
    const parsed = cli.parse(undefined, { run: false });
    if (cli.matchedCommand) {
      await cli.runMatchedCommand();
    }

    // Show help when run with no arguments and no command was matched
    if (
      !cli.matchedCommand &&
      parsed.args.length === 0 &&
      !parsed.options.help &&
      !parsed.options.version
    ) {
      cli.outputHelp();
    }
  } catch (error) {
    if (error instanceof Error && error.constructor.name === "CACError") {
      runtime.error(`Error: ${error.message}\n`);
      if (cli.matchedCommand) {
        cli.matchedCommand.outputHelp();
      }
      runtime.exit(1);
    }
    throw error;
  }
};

if (import.meta.main) {
  const cli = createCli();
  await runCli(cli);
  process.exit(0);
}

// The root package.json is the single source of truth for the AOP version.
export function readCliPackageVersion(
  packageJsonPath = resolve(import.meta.dirname, "..", "..", "..", "package.json"),
): string {
  const buildVersion = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : undefined;
  if (buildVersion?.trim()) {
    return buildVersion.trim();
  }

  let packageJsonContent: string;
  try {
    packageJsonContent = readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    const envVersion = process.env.AOP_BUILD_VERSION;
    if (envVersion?.trim()) {
      return envVersion.trim();
    }

    throw error;
  }

  const packageJson = JSON.parse(packageJsonContent) as { version?: unknown };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("CLI package.json is missing a version");
  }

  return packageJson.version.trim();
}
