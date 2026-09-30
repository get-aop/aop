import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import cac, { type CAC } from "cac";
import {
  createCli,
  formatTimestamp,
  loadProjectEnv,
  parseEnvFile,
  readCliPackageVersion,
  registerCommands,
  runCli,
  setupLogging,
} from "./main";

describe("parseEnvFile", () => {
  test("parses key=value pairs", () => {
    const content = "FOO=bar\nBAZ=qux";
    const vars = parseEnvFile(content);
    expect(vars.get("FOO")).toBe("bar");
    expect(vars.get("BAZ")).toBe("qux");
    expect(vars.size).toBe(2);
  });

  test("skips comments and empty lines", () => {
    const content = "# comment\n\nFOO=bar\n  # indented comment\n";
    const vars = parseEnvFile(content);
    expect(vars.size).toBe(1);
    expect(vars.get("FOO")).toBe("bar");
  });

  test("skips lines without =", () => {
    const content = "INVALID_LINE\nFOO=bar";
    const vars = parseEnvFile(content);
    expect(vars.size).toBe(1);
    expect(vars.get("FOO")).toBe("bar");
  });

  test("handles values with = in them", () => {
    const content = "URL=http://localhost:3000?foo=bar";
    const vars = parseEnvFile(content);
    expect(vars.get("URL")).toBe("http://localhost:3000?foo=bar");
  });

  test("handles empty values", () => {
    const content = "EMPTY=";
    const vars = parseEnvFile(content);
    expect(vars.get("EMPTY")).toBe("");
  });

  test("returns empty map for empty content", () => {
    const vars = parseEnvFile("");
    expect(vars.size).toBe(0);
  });
});

describe("loadProjectEnv", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const projectRoot = resolve(import.meta.dirname, "..", "..", "..");
  const envPath = resolve(projectRoot, ".env");
  let originalEnvFile: string | null = null;

  beforeEach(async () => {
    savedEnv.AOP_LOCAL_SERVER_URL = process.env.AOP_LOCAL_SERVER_URL;
    const envFile = Bun.file(envPath);
    originalEnvFile = (await envFile.exists()) ? await envFile.text() : null;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (originalEnvFile === null) {
      await rm(envPath, { force: true });
      return;
    }

    await writeFile(envPath, originalEnvFile);
  });

  test("loads env vars from project root .env", async () => {
    await writeFile(envPath, "AOP_LOCAL_SERVER_URL=http://localhost:4111\n");
    delete process.env.AOP_LOCAL_SERVER_URL;

    await loadProjectEnv();

    const localServerUrl = process.env.AOP_LOCAL_SERVER_URL;
    expect(localServerUrl).toBeDefined();
    if (localServerUrl === undefined) {
      throw new Error("Expected AOP_LOCAL_SERVER_URL to be loaded from .env");
    }
    expect(localServerUrl === "http://localhost:4111").toBe(true);
  });

  test("does not overwrite existing env vars", async () => {
    process.env.AOP_LOCAL_SERVER_URL = "http://custom:9999";
    await loadProjectEnv();
    expect(process.env.AOP_LOCAL_SERVER_URL).toBe("http://custom:9999");
  });
});

describe("formatTimestamp", () => {
  test("formats date as YYYYMMDDHHmmss", () => {
    const date = new Date(2026, 0, 15, 9, 5, 3);
    expect(formatTimestamp(date)).toBe("20260115090503");
  });

  test("pads single-digit values with zeros", () => {
    const date = new Date(2026, 1, 3, 1, 2, 7);
    expect(formatTimestamp(date)).toBe("20260203010207");
  });

  test("handles midnight", () => {
    const date = new Date(2026, 11, 31, 0, 0, 0);
    expect(formatTimestamp(date)).toBe("20261231000000");
  });

  test("handles end of day", () => {
    const date = new Date(2026, 5, 15, 23, 59, 59);
    expect(formatTimestamp(date)).toBe("20260615235959");
  });
});

describe("setupLogging", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.AOP_LOG_DIR = process.env.AOP_LOG_DIR;
    savedEnv.AOP_LOG_LEVEL = process.env.AOP_LOG_LEVEL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("configures pretty logging without file sinks when log dir is unset", async () => {
    delete process.env.AOP_LOG_DIR;
    delete process.env.AOP_LOG_LEVEL;

    const mkdirMock = mock(async () => undefined);
    const configureLoggingMock = mock(async () => undefined);

    await setupLogging({
      mkdir: mkdirMock as never,
      configureLogging: configureLoggingMock as never,
      now: () => new Date(2026, 0, 1, 0, 0, 0),
    });

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(configureLoggingMock).toHaveBeenCalledWith({
      level: "info",
      format: "pretty",
      serviceName: "cli",
    });
  });

  test("configures file sinks when log dir is set", async () => {
    process.env.AOP_LOG_DIR = "/tmp/aop-cli-test-logs";
    process.env.AOP_LOG_LEVEL = "debug";

    const mkdirMock = mock(async () => undefined);
    const configureLoggingMock = mock(async () => undefined);

    await setupLogging({
      mkdir: mkdirMock as never,
      configureLogging: configureLoggingMock as never,
      now: () => new Date(2026, 0, 15, 9, 5, 3),
    });

    expect(mkdirMock).toHaveBeenCalledWith("/tmp/aop-cli-test-logs", { recursive: true });
    expect(configureLoggingMock).toHaveBeenCalledWith({
      level: "debug",
      format: "pretty",
      serviceName: "cli",
      sinks: {
        console: true,
        files: [
          { path: "/tmp/aop-cli-test-logs/aop-20260115090503.jsonl", format: "json" },
          { path: "/tmp/aop-cli-test-logs/aop-20260115090503.log", format: "pretty" },
        ],
      },
    });
  });
});

describe("registerCommands", () => {
  test("registers exactly the surviving commands", () => {
    const cli = cac("test-aop");
    registerCommands(cli);

    const commandNames = cli.commands.map((cmd) => cmd.name).sort();
    expect(commandNames).toEqual([
      "config:get",
      "config:set",
      "repo:init",
      "repo:remove",
      "session",
    ]);
  });

  test("repo:remove takes no --force option", () => {
    const cli = cac("test-aop");
    registerCommands(cli);

    const cmd = cli.commands.find((c) => c.name === "repo:remove");
    expect(cmd).toBeDefined();
    expect(cmd?.options).toHaveLength(0);
  });

  test("dispatches documented session workspace commands through CAC", async () => {
    const cli = cac("test-aop");
    const setWorkspace = mock(async () => undefined);
    const resetWorkspace = mock(async () => undefined);
    registerCommands(cli, {
      sessionWorkspaceSetCommand: setWorkspace,
      sessionWorkspaceResetCommand: resetWorkspace,
    } as never);

    cli.parse(["bun", "test-aop", "session", "workspace", "set", "isess_1", "/tmp/wt"], {
      run: false,
    });
    await cli.runMatchedCommand();
    expect(setWorkspace).toHaveBeenCalledWith("isess_1", "/tmp/wt");

    cli.parse(["bun", "test-aop", "session", "workspace", "reset", "isess_1"], {
      run: false,
    });
    await cli.runMatchedCommand();
    expect(resetWorkspace).toHaveBeenCalledWith("isess_1");
  });

  test("wires command actions to the provided handlers", async () => {
    const cli = cac("test-aop");
    const handlers = {
      repoInitCommand: mock(() => undefined),
      repoRemoveCommand: mock(() => undefined),
      configGetCommand: mock(() => undefined),
      configSetCommand: mock(() => undefined),
    };

    registerCommands(cli, handlers as never);

    const getCommandAction = (name: string): ((...args: unknown[]) => unknown) => {
      const command = cli.commands.find((entry) => entry.name === name) as
        | ({ commandAction: (...args: unknown[]) => unknown } & Record<string, unknown>)
        | undefined;
      expect(command).toBeDefined();
      if (!command) {
        throw new Error(`Missing command action for ${name}`);
      }
      return command.commandAction;
    };

    getCommandAction("repo:init")("/repo");
    getCommandAction("repo:remove")("/repo");
    getCommandAction("config:get")("chat_global_instructions");
    getCommandAction("config:set")("chat_global_instructions", "Prefer small diffs");

    expect(handlers.repoInitCommand).toHaveBeenCalledWith("/repo");
    expect(handlers.repoRemoveCommand).toHaveBeenCalledWith("/repo");
    expect(handlers.configGetCommand).toHaveBeenCalledWith("chat_global_instructions");
    expect(handlers.configSetCommand).toHaveBeenCalledWith(
      "chat_global_instructions",
      "Prefer small diffs",
    );
  });
});

describe("createCli", () => {
  test("uses the root package version for the CLI version flag", async () => {
    const packageJson = (await Bun.file(
      resolve(import.meta.dirname, "..", "..", "..", "package.json"),
    ).json()) as {
      version: string;
    };
    const cli = createCli();

    expect(cli.globalCommand.versionNumber).toBe(packageJson.version);
  });

  test("prefers the root package version over ambient build version in source runs", async () => {
    const originalVersion = process.env.AOP_BUILD_VERSION;
    const packageJson = (await Bun.file(
      resolve(import.meta.dirname, "..", "..", "..", "package.json"),
    ).json()) as {
      version: string;
    };
    process.env.AOP_BUILD_VERSION = "9.9.9+ambient";

    try {
      expect(readCliPackageVersion()).toBe(packageJson.version);
    } finally {
      if (originalVersion === undefined) {
        delete process.env.AOP_BUILD_VERSION;
      } else {
        process.env.AOP_BUILD_VERSION = originalVersion;
      }
    }
  });

  test("uses the injected build version when package.json is unavailable in compiled installs", () => {
    const originalVersion = process.env.AOP_BUILD_VERSION;
    process.env.AOP_BUILD_VERSION = "0.1.18+abc123";

    try {
      expect(readCliPackageVersion(resolve(import.meta.dirname, "missing-package.json"))).toBe(
        "0.1.18+abc123",
      );
    } finally {
      if (originalVersion === undefined) {
        delete process.env.AOP_BUILD_VERSION;
      } else {
        process.env.AOP_BUILD_VERSION = originalVersion;
      }
    }
  });

  test("handles unknown command through configured output and exit handlers", () => {
    const errorMock = mock(() => undefined);
    const exitMock = mock(() => {
      throw new Error("process.exit");
    }) as unknown as (code: number) => never;

    const cli = createCli({
      error: errorMock,
      exit: exitMock,
    });

    (cli as unknown as { args: string[] }).args = ["bad", "command"];

    expect(() => cli.dispatchEvent(new Event("command:*"))).toThrow("process.exit");
    expect(errorMock).toHaveBeenNthCalledWith(1, "Unknown command: bad command");
    expect(errorMock).toHaveBeenNthCalledWith(2, 'Run "aop --help" for usage');
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});

describe("runCli", () => {
  test("loads env, sets up logging, and outputs help when no args are passed", async () => {
    const loadProjectEnvMock = mock(async () => undefined);
    const setupLoggingMock = mock(async () => undefined);
    const exitMock = mock(() => {
      throw new Error("process.exit");
    }) as unknown as (code: number) => never;
    const errorMock = mock(() => undefined);
    const outputHelpMock = mock(() => undefined);

    const cli = {
      parse: () => ({ args: [], options: { help: false, version: false } }),
      outputHelp: outputHelpMock,
      matchedCommand: undefined,
    } as unknown as CAC;

    await runCli(cli, {
      loadProjectEnv: loadProjectEnvMock,
      setupLogging: setupLoggingMock,
      exit: exitMock,
      error: errorMock,
    });

    expect(loadProjectEnvMock).toHaveBeenCalledTimes(1);
    expect(setupLoggingMock).toHaveBeenCalledTimes(1);
    expect(outputHelpMock).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  test("does not output help when help flag is already set", async () => {
    const outputHelpMock = mock(() => undefined);

    const cli = {
      parse: () => ({ args: [], options: { help: true, version: false } }),
      outputHelp: outputHelpMock,
      matchedCommand: undefined,
    } as unknown as CAC;

    await runCli(cli, {
      loadProjectEnv: async () => undefined,
      setupLogging: async () => undefined,
      exit: process.exit,
      error: mock(() => undefined),
    });

    expect(outputHelpMock).not.toHaveBeenCalled();
  });

  test("awaits matched async command actions", async () => {
    let commandCompleted = false;
    const parseMock = mock(() => ({ args: ["repo"], options: { help: false, version: false } }));
    const runMatchedCommandMock = mock(async () => {
      await Bun.sleep(1);
      commandCompleted = true;
    });

    const cli = {
      parse: parseMock,
      runMatchedCommand: runMatchedCommandMock,
      outputHelp: mock(() => undefined),
      matchedCommand: {},
    } as unknown as CAC;

    await runCli(cli, {
      loadProjectEnv: async () => undefined,
      setupLogging: async () => undefined,
      exit: process.exit,
      error: mock(() => undefined),
    });

    expect(parseMock).toHaveBeenCalledWith(undefined, { run: false });
    expect(runMatchedCommandMock).toHaveBeenCalledTimes(1);
    expect(commandCompleted).toBe(true);
  });

  test("handles CAC errors by printing error, outputting command help, and exiting", async () => {
    class CACError extends Error {}

    const loadProjectEnvMock = mock(async () => undefined);
    const setupLoggingMock = mock(async () => undefined);
    const exitMock = mock(() => {
      throw new Error("process.exit");
    }) as unknown as (code: number) => never;
    const errorMock = mock(() => undefined);
    const commandHelpMock = mock(() => undefined);

    const cli = {
      parse: () => {
        throw new CACError("Invalid option");
      },
      outputHelp: mock(() => undefined),
      matchedCommand: { outputHelp: commandHelpMock },
    } as unknown as CAC;

    await expect(
      runCli(cli, {
        loadProjectEnv: loadProjectEnvMock,
        setupLogging: setupLoggingMock,
        exit: exitMock,
        error: errorMock,
      }),
    ).rejects.toThrow("process.exit");

    expect(errorMock).toHaveBeenCalledWith("Error: Invalid option\n");
    expect(commandHelpMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  test("rethrows non-CAC errors", async () => {
    const failure = new Error("boom");
    const exitMock = mock(() => {
      throw new Error("process.exit");
    }) as unknown as (code: number) => never;

    const cli = {
      parse: () => {
        throw failure;
      },
      outputHelp: mock(() => undefined),
      matchedCommand: undefined,
    } as unknown as CAC;

    await expect(
      runCli(cli, {
        loadProjectEnv: async () => undefined,
        setupLogging: async () => undefined,
        exit: exitMock,
        error: mock(() => undefined),
      }),
    ).rejects.toThrow("boom");

    expect(exitMock).not.toHaveBeenCalled();
  });
});
