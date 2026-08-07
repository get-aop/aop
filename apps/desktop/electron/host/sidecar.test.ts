import { describe, expect, test } from "bun:test";
import {
  buildNativeSidecarLaunchConfig,
  buildWslLaunchScript,
  buildWslSidecarLaunchConfig,
  classifySidecarFailure,
  existingServerMatchesSidecarVersion,
  isValidRuntimeFingerprint,
  parseSidecarPorts,
  provisionManagedRuntimeArgv,
  releaseKnownWslRuntimeArgv,
  sidecarSpawnCommand,
} from "./sidecar";

describe("Electron sidecar host support", () => {
  test("builds the native launch contract", () => {
    const config = buildNativeSidecarLaunchConfig(
      { executable: "/Applications/AOP.app/Contents/Resources/aop", logDir: "/tmp/aop-logs" },
      { localServer: 25150, dashboard: 25160 },
      false,
    );

    expect(config.program).toBe("/Applications/AOP.app/Contents/Resources/aop");
    expect(config.args).toEqual(["run"]);
    expect(config.env.AOP_LOCAL_SERVER_PORT).toBe("25150");
    expect(config.env.AOP_DASHBOARD_URL).toBe("http://127.0.0.1:25150");
    expect(config.healthUrl).toBe("http://127.0.0.1:25150/api/health");
    expect(config.dashboardUrl).toBe("http://127.0.0.1:25150/?aopDesktop=1");
    expect(config.env.PATH).toContain("/opt/homebrew/bin");
  });

  test("uses the separate dashboard port in isolated development", () => {
    const config = buildNativeSidecarLaunchConfig(
      { executable: "/x/aop", logDir: "/x/logs" },
      { localServer: 25360, dashboard: 25370 },
      true,
    );

    expect(config.env.AOP_DASHBOARD_URL).toBe("http://127.0.0.1:25370");
    expect(config.env.NODE_ENV).toBe("development");
    expect(config.dashboardUrl).toBe("http://127.0.0.1:25370/?aopDesktop=1");
  });

  test("builds WSL launch commands without Windows paths", () => {
    const config = buildWslSidecarLaunchConfig(
      "Ubuntu",
      "0.9.49",
      { localServer: 25150, dashboard: 25160 },
      false,
    );
    const spawn = sidecarSpawnCommand(config);
    const script = decodeScript(spawn.args);

    expect(config.mode).toEqual({ kind: "wsl", distro: "Ubuntu" });
    expect(config.program).toBe(".aop/desktop-runtime/0.9.49/aop");
    expect(config.env.PATH).toBeUndefined();
    expect(config.env.AOP_LOG_DIR).toBeUndefined();
    expect(spawn.program).toBe("wsl.exe");
    expect(script).toContain("AOP_EXEC_HOST='wsl:Ubuntu'");
    expect(script).toEndWith(
      'AOP_LOG_DIR="$HOME/.aop/logs" exec "$HOME"/\'.aop/desktop-runtime/0.9.49/aop\' run',
    );
  });

  test("drops Windows path and log values from WSL scripts", () => {
    const script = buildWslLaunchScript(
      {
        AOP_LOCAL_SERVER_PORT: "25150",
        PATH: "C:\\Windows",
        AOP_LOG_DIR: "C:\\Users\\m\\.aop\\logs",
      },
      ".aop/desktop-runtime/0.9.49/aop",
    );

    expect(script).toContain("AOP_LOCAL_SERVER_PORT='25150'");
    expect(script).not.toContain("C:\\Windows");
    expect(script).not.toContain("C:\\Users");
  });

  test("validates port overrides and failure classification", () => {
    expect(parseSidecarPorts("25260", "25270")).toEqual({
      localServer: 25260,
      dashboard: 25270,
    });
    expect(parseSidecarPorts("nope", "0")).toEqual({ localServer: 25150, dashboard: 25160 });
    expect(classifySidecarFailure(true, false)).toBe("healthy");
    expect(classifySidecarFailure(false, true)).toBe("localhost-forwarding-blocked");
    expect(classifySidecarFailure(false, false)).toBe("sidecar-never-started");
  });

  test("validates runtime fingerprints and release compatibility", () => {
    expect(isValidRuntimeFingerprint("a".repeat(64))).toBe(true);
    expect(isValidRuntimeFingerprint("abc123")).toBe(false);
    expect(isValidRuntimeFingerprint("Z".repeat(64))).toBe(false);
    expect(existingServerMatchesSidecarVersion("0.9.49", "0.9.49+desktop")).toBe(true);
    expect(existingServerMatchesSidecarVersion("0.9.48", "0.9.49")).toBe(false);
  });

  test("provisions the release-matched WSL runtime atomically", () => {
    const argv = provisionManagedRuntimeArgv(
      "Ubuntu",
      "0.9.49",
      "C:\\Program Files\\AOP\\aop-linux-x64",
      "C:\\Program Files\\AOP\\runtime-assets.tar.gz",
      "a".repeat(64),
    );
    const script = decodeScript(argv);

    expect(script).toContain("runtime=\"$HOME/.aop/desktop-runtime\"/'0.9.49'");
    expect(script).toContain("wslpath -u 'C:\\Program Files\\AOP\\aop-linux-x64'");
    expect(script).toContain("runtime.previous");
    expect(script).toContain("runtime installation is already in progress");
    expect(script).not.toContain("command -v aop");
  });

  test("releases only managed WSL runtimes", () => {
    const script = decodeScript(releaseKnownWslRuntimeArgv("Ubuntu"));

    expect(script).toContain("systemctl --user stop aop-local-server.service");
    expect(script).toContain("desktop-sidecar.pid");
    expect(script).toContain("/proc/$pid/exe");
    expect(script).not.toContain("pkill");
  });
});

const decodeScript = (argv: string[]): string => {
  const encoded = argv[5]?.replace("printf %s ", "").replace(" | base64 -d | bash", "");
  return Buffer.from(encoded ?? "", "base64").toString();
};
