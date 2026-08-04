import { describe, expect, test } from "bun:test";
import { buildOpenExternalCommand, isAllowedExternalUrl, isRunningInWsl } from "./external-url.ts";

describe("external URL opener", () => {
  test("allows https URLs and loopback http URLs only", () => {
    expect(isAllowedExternalUrl("https://github.com/get-aop/aop-mono/pull/99")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1:25150/tasks/task-1")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:25150/tasks/task-1")).toBe(true);
    expect(isAllowedExternalUrl("http://aop.localhost:25150/tasks/task-1")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(false);
    expect(isAllowedExternalUrl("file:///Users/marcelorm/.ssh/id_rsa")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });

  test("builds platform opener commands without shell interpolation", () => {
    expect(buildOpenExternalCommand("https://github.com/o/r/pull/1", "darwin")).toEqual([
      "open",
      "https://github.com/o/r/pull/1",
    ]);
    expect(buildOpenExternalCommand("https://github.com/o/r/pull/1", "linux", false)).toEqual([
      "xdg-open",
      "https://github.com/o/r/pull/1",
    ]);
    expect(buildOpenExternalCommand("https://github.com/o/r/pull/1", "win32")).toEqual([
      "rundll32.exe",
      "url.dll,FileProtocolHandler",
      "https://github.com/o/r/pull/1",
    ]);
  });

  test("opens via explorer.exe when running as a Linux process inside WSL", () => {
    expect(buildOpenExternalCommand("https://github.com/o/r/pull/1", "linux", true)).toEqual([
      "explorer.exe",
      "https://github.com/o/r/pull/1",
    ]);
  });

  test("detects WSL from interop environment variables", () => {
    expect(isRunningInWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
    expect(isRunningInWsl({ WSL_INTEROP: "/run/WSL/8_interop" })).toBe(true);
    expect(isRunningInWsl({})).toBe(false);
  });
});
