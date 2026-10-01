import { describe, expect, test } from "bun:test";
import { hostPort } from "./host-port.ts";
import { detectInstall, detectPlatform, hostAssetName } from "./install-layout.ts";

describe("install layout", () => {
  test("only a compiled binary named aop can replace itself", () => {
    expect(detectInstall("/home/me/.local/bin/aop", "0.9.51+abc")).toEqual({
      installDir: "/home/me/.local/bin",
      binaryPath: "/home/me/.local/bin/aop",
      dashboardDir: "/home/me/.local/bin/dashboard",
    });
    expect(detectInstall("/usr/local/bin/bun", "0.9.51")).toBeNull();
    expect(detectInstall("/home/me/.local/bin/aop", undefined)).toBeNull();
  });

  test("names the release binary as install.sh does, and refuses platforms without a host", () => {
    expect(hostAssetName(detectPlatform("darwin", "arm64") ?? { os: "linux", arch: "x64" })).toBe(
      "aop-darwin-arm64",
    );
    expect(hostAssetName(detectPlatform("linux", "x64") ?? { os: "darwin", arch: "arm64" })).toBe(
      "aop-linux-x64",
    );
    expect(detectPlatform("win32", "x64")).toBeNull();
    expect(detectPlatform("linux", "x64", true)).toEqual({ os: "linux", arch: "x64" });
    expect(detectPlatform("linux", "ia32")).toBeNull();
  });

  test("an x64 host running under Rosetta updates to the arm64 build", () => {
    expect(detectPlatform("darwin", "x64", true)).toEqual({ os: "darwin", arch: "arm64" });
    expect(detectPlatform("darwin", "x64", false)).toEqual({ os: "darwin", arch: "x64" });
  });

  test("reads the port the way aop run does", () => {
    expect(hostPort({})).toBe(25150);
    expect(hostPort({ AOP_LOCAL_SERVER_PORT: "26000" })).toBe(26000);
    expect(hostPort({ AOP_LOCAL_SERVER_PORT: "nope" })).toBe(25150);
  });
});
