import { describe, expect, mock, test } from "bun:test";
import {
  parseUninstallerArgs,
  type UninstallDependencies,
  uninstallFromSource,
} from "./source-uninstall";

describe("parseUninstallerArgs", () => {
  test("recognizes help flags without side effects", () => {
    expect(parseUninstallerArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseUninstallerArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseUninstallerArgs(["--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("uninstallFromSource", () => {
  test("stops and removes the systemd service, unlinks the CLI, and cleans logs on Linux", async () => {
    const commands: string[][] = [];
    const getProcessCwd = mock(async () => null);
    const killProcess = mock<(pid: number) => Promise<void>>(async () => undefined);
    const listProcesses = mock(async () => []);
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(commands).toEqual([
      ["systemctl", "--user", "disable", "--now", "aop-local-server.service"],
      ["systemctl", "--user", "daemon-reload"],
      ["bun", "unlink"],
    ]);
    expect(removeFile).toHaveBeenCalledWith(
      "/home/marcelo/.config/systemd/user/aop-local-server.service",
    );
    expect(removeDir).toHaveBeenCalledWith("/home/marcelo/.aop/logs");
  });

  test("unloads and removes the launch agent, unlinks the CLI, and cleans logs on macOS", async () => {
    const commands: string[][] = [];
    const getProcessCwd = mock(async () => null);
    const killProcess = mock<(pid: number) => Promise<void>>(async () => undefined);
    const listProcesses = mock(async () => []);
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });

    await uninstallFromSource({
      platform: "darwin",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/Users/marcelo",
      workspaceDir: "/repo",
    });

    expect(commands).toEqual([
      ["launchctl", "unload", "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist"],
      ["bun", "unlink"],
    ]);
    expect(removeFile).toHaveBeenCalledWith(
      "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist",
    );
    expect(removeDir).toHaveBeenCalledWith("/Users/marcelo/.aop/logs");
  });

  test("kills stray bun processes tied to the current AOP workspace before unlinking", async () => {
    const commands: string[][] = [];
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const killProcess = mock<(pid: number) => Promise<void>>(async () => undefined);
    const listProcesses = mock(async () => [
      { pid: process.pid, command: "bun scripts/source-uninstall.ts" },
      { pid: 1001, command: "bun run ./scripts/dev.ts --no-dashboard" },
      { pid: 1002, command: "bun run --watch ./src/run.ts" },
      { pid: 1003, command: "bun run ./dev.ts" },
      { pid: 1004, command: "bun run ./some-other-project.ts" },
      { pid: 1005, command: "node server.js" },
    ]);
    const getProcessCwd = mock(async (pid: number) => {
      switch (pid) {
        case process.pid:
          return "/repo";
        case 1001:
          return "/repo";
        case 1002:
          return "/repo/apps/local-server";
        case 1003:
          return "/repo/apps/dashboard";
        case 1004:
          return "/tmp/other-project";
        default:
          return null;
      }
    });

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(killProcess).toHaveBeenCalledTimes(3);
    expect(killProcess).toHaveBeenNthCalledWith(1, 1001);
    expect(killProcess).toHaveBeenNthCalledWith(2, 1002);
    expect(killProcess).toHaveBeenNthCalledWith(3, 1003);
    expect(commands).toEqual([
      ["systemctl", "--user", "disable", "--now", "aop-local-server.service"],
      ["systemctl", "--user", "daemon-reload"],
      ["bun", "unlink"],
    ]);
  });

  test("leaves the servers of other checkouts and worktrees running", async () => {
    const killProcess = mock<(pid: number) => Promise<void>>(async () => undefined);
    const listProcesses = mock(async () => [
      // A launchd service runs with a relative script and its checkout as the working directory.
      { pid: 2001, command: "bun run apps/local-server/src/run.ts" },
      { pid: 2002, command: "bun /repo/.claude/worktrees/a1/apps/local-server/src/run.ts" },
      // Another checkout's dev server and verify stack; one shares a prefix with this checkout.
      { pid: 3001, command: "bun run ./scripts/dev.ts" },
      { pid: 3002, command: "bun /other/apps/local-server/src/run.ts" },
      { pid: 3003, command: "bun /repo-two/apps/local-server/src/run.ts" },
      { pid: 3004, command: "bun run --cwd=/repo-two ./scripts/dev.ts" },
    ]);
    const getProcessCwd = mock(async (pid: number) => {
      switch (pid) {
        case 2001:
          return "/repo";
        case 3001:
          return "/other";
        case 3003:
          return "/repo-two/apps/local-server";
        default:
          return null;
      }
    });

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir: mock(async () => undefined),
        removeFile: mock(async () => undefined),
        run: mock(async () => undefined),
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(killProcess.mock.calls.map(([pid]) => pid)).toEqual([2001, 2002]);
  });

  test("continues when a discovered workspace process already exited before cleanup", async () => {
    const exitedProcess = Bun.spawn(["sh", "-c", "exit 0"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitedPid = exitedProcess.pid;
    await exitedProcess.exited;

    const commands: string[][] = [];
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const listProcesses = mock(async () => [
      { pid: exitedPid, command: "bun run ./scripts/dev.ts --no-dashboard" },
    ]);
    const getProcessCwd = mock(async () => "/repo");

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir,
        removeFile,
        run,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(commands).toEqual([
      ["systemctl", "--user", "disable", "--now", "aop-local-server.service"],
      ["systemctl", "--user", "daemon-reload"],
      ["bun", "unlink"],
    ]);
  });
});
