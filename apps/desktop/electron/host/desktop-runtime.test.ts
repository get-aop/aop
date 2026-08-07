import { describe, expect, mock, test } from "bun:test";
import { createDesktopRuntime, defaultLogDirFor } from "./desktop-runtime";
import type { CommandOutput } from "./types";

describe("Electron desktop process runtime", () => {
  test("resolves the AOP log directory on macOS and Windows", () => {
    expect(defaultLogDirFor("unix", { HOME: "/Users/aop" })).toBe("/Users/aop/.aop/logs");
    expect(
      defaultLogDirFor("windows", {
        HOME: "C:\\fallback",
        USERPROFILE: "C:\\Users\\aop",
      }),
    ).toBe("C:\\Users\\aop/.aop/logs");
    expect(defaultLogDirFor("unix", { HOME: "/Users/aop", AOP_LOG_DIR: "/tmp/aop-logs" })).toBe(
      "/tmp/aop-logs",
    );
  });

  test("starts the bundled native sidecar and stops it on shutdown", async () => {
    const calls: Array<{ program: string; args: string[]; env: Record<string, string> }> = [];
    const kill = mock(() => undefined);
    const runtime = createDesktopRuntime({
      platform: "unix",
      version: "0.9.49",
      resourcePath: (name) => `/Applications/AOP.app/Contents/Resources/${name}`,
      env: { HOME: "/Users/aop" },
      loadExecHost: async () => ({ kind: "native" }),
      isHealthy: sequence(false, true),
      execute: async () => failure(),
      spawn: (program, args, options) => {
        calls.push({ program, args, env: options.env });
        return { pid: 1234, kill, exited: Promise.resolve(0) };
      },
      mkdir: async () => undefined,
      readText: async () => "",
      wait: async () => undefined,
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: "ready",
      dashboardUrl: "http://127.0.0.1:25150/?aopDesktop=1",
    });
    expect(calls[0]).toMatchObject({
      program: "/Applications/AOP.app/Contents/Resources/aop",
      args: ["run"],
      env: expect.objectContaining({
        AOP_LOCAL_SERVER_PORT: "25150",
        AOP_LOG_DIR: "/Users/aop/.aop/logs",
      }),
    });

    await runtime.stop();

    expect(kill).toHaveBeenCalledTimes(1);
  });

  test("reuses an existing server only when its release matches the bundled sidecar", async () => {
    const spawn = mock(() => ({ pid: 1234, kill: () => undefined, exited: Promise.resolve(0) }));
    const execute = mock(async (program: string, args: string[]): Promise<CommandOutput> => {
      if (program.endsWith("/aop") && args[0] === "--version") {
        return { status: 0, stdout: "aop/0.9.49 darwin-arm64", stderr: "" };
      }
      return failure();
    });
    const runtime = createDesktopRuntime({
      platform: "unix",
      version: "0.9.49",
      resourcePath: (name) => `/resources/${name}`,
      env: { HOME: "/Users/aop" },
      loadExecHost: async () => ({ kind: "native" }),
      isHealthy: async () => true,
      readServerVersion: async () => "0.9.49+release",
      execute,
      spawn,
      mkdir: async () => undefined,
      readText: async () => "",
      wait: async () => undefined,
    });

    await expect(runtime.start()).resolves.toMatchObject({ status: "ready" });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("provisions and launches the managed runtime inside WSL", async () => {
    const executed: Array<{ program: string; args: string[] }> = [];
    const spawned: Array<{ program: string; args: string[] }> = [];
    const runtime = createDesktopRuntime({
      platform: "windows",
      version: "0.9.49",
      resourcePath: (name) => `C:\\Program Files\\AOP\\resources\\${name}`,
      env: { USERPROFILE: "C:\\Users\\aop" },
      loadExecHost: async () => ({ kind: "wsl", distro: "Ubuntu" }),
      isHealthy: sequence(false, false, true),
      execute: async (program, args) => {
        executed.push({ program, args });
        return success();
      },
      spawn: (program, args) => {
        spawned.push({ program, args });
        return { pid: 2345, kill: () => undefined, exited: Promise.resolve(0) };
      },
      mkdir: async () => undefined,
      readText: async (path) => (path.endsWith("desktop-runtime.sha256") ? "a".repeat(64) : ""),
      wait: async () => undefined,
    });

    await expect(runtime.start()).resolves.toMatchObject({ status: "ready" });
    expect(executed.some((call) => call.program === "wsl.exe")).toBe(true);
    expect(spawned[0]?.program).toBe("wsl.exe");
  });
});

const success = (): CommandOutput => ({ status: 0, stdout: "", stderr: "" });
const failure = (): CommandOutput => ({ status: 1, stdout: "", stderr: "not found" });

const sequence = (...values: boolean[]) => {
  let index = 0;
  return async () => values[Math.min(index++, values.length - 1)] ?? false;
};
