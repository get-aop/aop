import { describe, expect, test } from "bun:test";
import { CHANNELS } from "@aop/common";
import { hostPort } from "./host-port.ts";
import {
  detectInstall,
  detectPlatform,
  hostAssetName,
  selfUpdateBlock,
  selfUpdateRefusal,
} from "./install-layout.ts";

describe("install layout", () => {
  test("only a compiled binary named aop can replace itself", () => {
    expect(detectInstall("/home/me/.local/bin/aop", "0.9.51+abc")).toEqual({
      installDir: "/home/me/.local/bin",
      binaryPath: "/home/me/.local/bin/aop",
      dashboardDir: "/home/me/.local/bin/dashboard",
    });
    expect(detectInstall("/usr/local/bin/bun", "0.9.51")).toBeNull();
    // AOP Nightly's binary is aop-nightly in its own folder; stable's aop is not it.
    expect(
      detectInstall(
        "/u/.aop-nightly/bin/aop-nightly",
        "0.10.7-nightly.20261002.14",
        CHANNELS.nightly,
      ),
    ).toMatchObject({ dashboardDir: "/u/.aop-nightly/bin/dashboard" });
    expect(detectInstall("/home/me/.local/bin/aop", "0.9.51", CHANNELS.nightly)).toBeNull();
    expect(detectInstall("/u/.aop-nightly/bin/aop-nightly", "0.9.51")).toBeNull();
    expect(detectInstall("/home/me/.local/bin/aop", undefined)).toBeNull();
  });

  test("the host the macOS app ships in its bundle never replaces itself", () => {
    const bundled = "/Applications/AOP.app/Contents/Resources/aop";

    expect(detectInstall(bundled, "0.10.7+c4a98d8", CHANNELS.stable)).toBeNull();
    expect(selfUpdateBlock(bundled, "0.10.7+c4a98d8", CHANNELS.stable)).toBe("app");
    expect(selfUpdateRefusal("app", bundled, CHANNELS.stable)).toBe(
      "This host comes with the AOP app and updates with it: update the app instead.",
    );
  });

  test("says why each other host cannot update itself, in its channel's own command", () => {
    expect(selfUpdateBlock("/repo/node_modules/.bin/bun", undefined)).toBe("source");
    expect(selfUpdateBlock("/tmp/aop-nightly", "0.10.8-nightly.1", CHANNELS.nightly)).toBeNull();
    expect(selfUpdateBlock("/Downloads/aop-linux-x64", "0.10.7", CHANNELS.stable)).toBe(
      "other-binary",
    );
    expect(selfUpdateRefusal("other-binary", "/Downloads/x", CHANNELS.nightly)).toBe(
      '`aop-nightly update` replaces the installed "aop-nightly" binary, and this one is /Downloads/x. Install the release with install.sh, or run `aop-nightly update --check` to only look.',
    );
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
