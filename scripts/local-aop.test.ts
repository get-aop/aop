import { describe, expect, mock, test } from "bun:test";
import {
  buildLocalAopStartCommand,
  getLocalAopPaths,
  type LocalAopDependencies,
  localAop,
  parseLocalAopArgs,
} from "./local-aop";

describe("parseLocalAopArgs", () => {
  test("defaults start to the local dev ports", () => {
    expect(parseLocalAopArgs(["start"])).toEqual({
      command: "start",
      dashboardPort: 25260,
      serverPort: 25250,
    });
  });

  test("accepts custom ports", () => {
    expect(
      parseLocalAopArgs(["start", "--server-port", "25350", "--dashboard-port=25360"]),
    ).toEqual({
      command: "start",
      dashboardPort: 25360,
      serverPort: 25350,
    });
  });

  test("accepts a workspace path override", () => {
    expect(parseLocalAopArgs(["start", "--workspace", "/repo/pr-115"])).toEqual({
      command: "start",
      dashboardPort: 25260,
      serverPort: 25250,
      workspaceDir: "/repo/pr-115",
    });
  });

  test("rejects unknown arguments", () => {
    expect(() => parseLocalAopArgs(["start", "--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("getLocalAopPaths", () => {
  test("isolates state by worktree basename and git hash", () => {
    expect(
      getLocalAopPaths({
        homeDir: "/Users/marcelo",
        workspaceDir: "/Users/marcelo/.codex/worktrees/4148/aop-mono",
      }),
    ).toEqual({
      aopHome: "/Users/marcelo/.aop-local-dev/aop-mono-c1b99b",
      logPath: "/Users/marcelo/.aop-local-dev/aop-mono-c1b99b/logs/dev.log",
    });
  });
});

describe("buildLocalAopStartCommand", () => {
  test("runs bun dev from the selected worktree with isolated env", () => {
    const command = buildLocalAopStartCommand({
      aopHome: "/Users/marcelo/.aop-local-dev/aop-mono-25db7b",
      bunPath: "/Users/marcelo/.bun/bin/bun",
      dashboardPort: 25360,
      licenseServerUrl: "https://license.local",
      serverPort: 25350,
      workspaceDir: "/Users/marcelo/.codex/worktrees/4148/aop-mono",
    });

    expect(command).toContain('cd "/Users/marcelo/.codex/worktrees/4148/aop-mono"');
    expect(command).toContain('AOP_HOME="/Users/marcelo/.aop-local-dev/aop-mono-25db7b"');
    expect(command).toContain(
      'AOP_DB_PATH="/Users/marcelo/.aop-local-dev/aop-mono-25db7b/aop.sqlite"',
    );
    expect(command).toContain("AOP_LOCAL_SERVER_PORT=25350");
    expect(command).toContain('AOP_LOCAL_SERVER_URL="http://127.0.0.1:25350"');
    expect(command).toContain("AOP_DASHBOARD_PORT=25360");
    expect(command).toContain('AOP_DASHBOARD_URL="http://127.0.0.1:25360"');
    expect(command).toContain('AOP_LICENSE_SERVER_URL="https://license.local"');
    expect(command).toContain('AOP_TEST_MODE="false"');
    expect(command).toContain('"/Users/marcelo/.bun/bin/bun" run dev');
  });
});

describe("localAop", () => {
  test("start clears launchd and default ports before submitting the local worktree", async () => {
    const calls: string[][] = [];
    const deps: Partial<LocalAopDependencies> = {
      ensureDir: mock(async () => undefined),
      getWorkspaceDir: mock(async () => {
        throw new Error("workspace should come from args");
      }),
      run: mock(async (command: string[]) => {
        calls.push(command);
      }),
      truncateFile: mock(async () => undefined),
      waitForHealth: mock(async () => undefined),
      write: mock(() => undefined),
    };

    await localAop({
      args: ["start", "--workspace", "/repo"],
      dependencies: deps,
      homeDir: "/home/marcelo",
      platform: "darwin",
    });

    expect(calls[0]).toEqual(["launchctl", "remove", "com.aop.local-dev"]);
    expect(calls[1]).toEqual(["sh", "-lc", "lsof -ti tcp:25250 | xargs kill -9"]);
    expect(calls[2]).toEqual(["sh", "-lc", "lsof -ti tcp:25260 | xargs kill -9"]);
    expect(calls[3]?.slice(0, 5)).toEqual(["launchctl", "submit", "-l", "com.aop.local-dev", "-o"]);
  });
});
