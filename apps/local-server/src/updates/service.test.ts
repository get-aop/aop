import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildMacosAppUpgradeScript,
  buildUpgradeScript,
  buildWindowsUpgradeScript,
  requiredReleaseAssetNames,
} from "./upgrade-scripts.ts";

const mockIsCompiledBinaryInstall = mock(async () => true);

mock.module("./version.ts", () => ({
  isCompiledBinaryInstall: mockIsCompiledBinaryInstall,
  resolveInstalledVersion: mock(async () => "0.0.0"),
}));

// bun test runs every file in one process and routes.test.ts leaves "./service.ts"
// mocked in the shared module registry, so import a fresh instance via a query-suffixed
// specifier. The fresh instance still resolves ./version.ts through the mock above.
// @ts-expect-error the query suffix is a Bun module-registry key that tsc cannot resolve.
const service = (await import("./service.ts?real")) as typeof import("./service.ts");
const {
  buildMacosDmgDownloadUrl,
  buildUpgradeSpawnCommand,
  fetchLatestReleaseVersion,
  isDesktopManagedWsl,
  isMacosAppBundleInstall,
  isRunningInsideSystemdUnit,
  startBinaryUpgrade,
  verifyMacosDmgDownload,
  verifyReleaseAsset,
} = service;

const originalFetch = globalThis.fetch;
const originalEnv = process.env.AOP_RELEASES_URL;

const linuxAssetUrls = [
  "https://releases.test/v0.2.2/aop-linux-x64",
  "https://releases.test/v0.2.2/runtime-assets.tar.gz",
  "https://releases.test/v0.2.2/checksums.sha256",
];

const windowsAssetUrls = [
  "https://releases.test/v0.2.2/aop-windows-x64.exe",
  "https://releases.test/v0.2.2/runtime-assets.tar.gz",
  "https://releases.test/v0.2.2/checksums.sha256",
];

describe("updates/service", () => {
  beforeEach(() => {
    process.env.AOP_RELEASES_URL = "https://releases.test";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.AOP_RELEASES_URL;
    } else {
      process.env.AOP_RELEASES_URL = originalEnv;
    }
  });

  test("fetchLatestReleaseVersion reads the plain-text latest version", async () => {
    globalThis.fetch = mock(async () => new Response("0.2.2\n")) as unknown as typeof fetch;

    await expect(fetchLatestReleaseVersion()).resolves.toBe("0.2.2");
  });

  test("fetchLatestReleaseVersion surfaces HTTP failures", async () => {
    globalThis.fetch = mock(
      async () => new Response("missing", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(fetchLatestReleaseVersion()).rejects.toThrow("Version check failed");
  });

  test("requiredReleaseAssetNames matches the installer downloads per platform", () => {
    expect(requiredReleaseAssetNames("linux", "x64")).toEqual([
      "aop-linux-x64",
      "runtime-assets.tar.gz",
      "checksums.sha256",
    ]);
    expect(requiredReleaseAssetNames("darwin", "arm64")).toEqual([
      "aop-darwin-arm64",
      "runtime-assets.tar.gz",
      "checksums.sha256",
    ]);
    expect(requiredReleaseAssetNames("win32", "x64")).toEqual([
      "aop-windows-x64.exe",
      "runtime-assets.tar.gz",
      "checksums.sha256",
    ]);
  });

  test("buildUpgradeScript clears a stale listener before starting the upgraded server", () => {
    const script = buildUpgradeScript({
      aopBinary: "/Users/test/.local/bin/aop",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: linuxAssetUrls,
    });

    expect(script).toContain(`AOP_UPGRADE_PORT="\${AOP_LOCAL_SERVER_PORT:-25150}"`);
    expect(script).toContain("unload_launchd_service");
    expect(script).toContain(
      `launchctl unload "\${HOME}/Library/LaunchAgents/\${AOP_UPGRADE_SERVICE_NAME}.plist"`,
    );
    expect(script).toContain('"/Users/test/.local/bin/aop" stop >/dev/null 2>&1 || true');
    expect(script).toContain('lsof -tiTCP:"$AOP_UPGRADE_PORT" -sTCP:LISTEN');
    expect(script).toContain("kill $AOP_UPGRADE_PIDS >/dev/null 2>&1 || true");
    expect(script).toContain("kill -9 $AOP_UPGRADE_PIDS >/dev/null 2>&1 || true");
    expect(script.indexOf("wait_for_aop_port")).toBeLessThan(
      script.indexOf('sh "$AOP_UPGRADE_INSTALLER" --version "0.2.2"'),
    );
  });

  test("buildUpgradeScript redirects all output to a per-version log file", () => {
    const script = buildUpgradeScript({
      aopBinary: "/Users/test/.local/bin/aop",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: linuxAssetUrls,
    });

    expect(script).toContain(`AOP_UPGRADE_LOG_DIR="\${HOME}/.aop/logs"`);
    expect(script).toContain("upgrade-0.2.2-$(date +%s).log");
    expect(script).toContain('mkdir -p "$AOP_UPGRADE_LOG_DIR"');
    expect(script).toContain('exec >>"$AOP_UPGRADE_LOG" 2>&1');
    expect(script).toContain("log_step()");
  });

  test("buildUpgradeScript preflights every release asset before stopping the server", () => {
    const script = buildUpgradeScript({
      aopBinary: "/Users/test/.local/bin/aop",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: linuxAssetUrls,
    });
    const stopIndex = script.indexOf('"/Users/test/.local/bin/aop" stop');

    expect(script).toContain('curl -fsSIL -o /dev/null "$1"');
    expect(script).toContain("The current server was left running.");
    for (const assetUrl of linuxAssetUrls) {
      const preflightIndex = script.indexOf(`preflight_asset "${assetUrl}"`);
      expect(preflightIndex).toBeGreaterThan(-1);
      expect(preflightIndex).toBeLessThan(stopIndex);
    }
    // The installer is fetched to disk while the server is still up, so a dead CDN
    // can no longer kill the server via an empty curl | sh pipe.
    expect(
      script.indexOf('curl -fsSL "https://releases.test/install.sh" -o "$AOP_UPGRADE_INSTALLER"'),
    ).toBeLessThan(stopIndex);
  });

  test("buildUpgradeScript restarts the previous server when the install phase fails", () => {
    const script = buildUpgradeScript({
      aopBinary: "/Users/test/.local/bin/aop",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: linuxAssetUrls,
    });

    expect(script).toContain('if ! sh "$AOP_UPGRADE_INSTALLER" --version "0.2.2"; then');
    expect(script).toContain("restart_server || true");
    expect(script).toContain('systemctl --user start "$AOP_UPGRADE_SYSTEMD_SERVICE"');
    expect(script).toContain('AOP_UPGRADE_SYSTEMD_SERVICE="aop-local-server.service"');
    expect(script).toContain(
      `launchctl load "\${HOME}/Library/LaunchAgents/\${AOP_UPGRADE_SERVICE_NAME}.plist"`,
    );
    expect(script).toContain(
      '"/Users/test/.local/bin/aop" run --background --port "$AOP_UPGRADE_PORT"',
    );
    expect(script.indexOf('"/Users/test/.local/bin/aop" stop')).toBeLessThan(
      script.indexOf("restart_server || true"),
    );
  });

  test("buildWindowsUpgradeScript frees the port via Get-NetTCPConnection without lsof/launchctl", () => {
    const script = buildWindowsUpgradeScript({
      aopBinary: "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: windowsAssetUrls,
    });

    expect(script).toContain("Get-NetTCPConnection -LocalPort $port -State Listen");
    expect(script).toContain("Stop-Process -Id $_.OwningProcess -Force");
    expect(script).toContain('& "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe" stop');
    expect(script).toContain("https://releases.test/install.ps1");
    expect(script).toContain('-File $installer -Version "0.2.2"');
    expect(script).not.toContain("lsof");
    expect(script).not.toContain("launchctl");
  });

  test("buildWindowsUpgradeScript logs, preflights before the stop, and restarts on failure", () => {
    const script = buildWindowsUpgradeScript({
      aopBinary: "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
      requiredAssetUrls: windowsAssetUrls,
    });
    const stopIndex = script.indexOf('& "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe" stop');

    expect(script).toContain(
      'Start-Transcript -Path (Join-Path $logDir "upgrade-0.2.2.log") -Append',
    );
    expect(script).toContain(
      "Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 8",
    );
    for (const assetUrl of windowsAssetUrls) {
      const preflightIndex = script.indexOf(`Test-AopReleaseAsset "${assetUrl}"`);
      expect(preflightIndex).toBeGreaterThan(-1);
      expect(preflightIndex).toBeLessThan(stopIndex);
    }
    expect(script).toContain("function Restart-AopServer");
    expect(script).toContain(
      '& "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe" run --background --port $port',
    );
    expect(script).toContain(
      'if ($LASTEXITCODE -ne 0) { throw "Installer exited with code $LASTEXITCODE" }',
    );
    expect(stopIndex).toBeGreaterThan(-1);
    expect(script.indexOf("Restart-AopServer\n  Stop-Transcript")).toBeGreaterThan(stopIndex);
  });

  test("detects the bundled macOS app sidecar install path", () => {
    expect(isMacosAppBundleInstall("/Applications/AOP.app/Contents/Resources/aop", "darwin")).toBe(
      true,
    );
    expect(isMacosAppBundleInstall("/Users/test/.local/bin/aop", "darwin")).toBe(false);
    expect(isMacosAppBundleInstall("/Applications/AOP.app/Contents/Resources/aop", "linux")).toBe(
      false,
    );
  });

  test("buildMacosDmgDownloadUrl selects the app DMG for the current architecture", () => {
    expect(buildMacosDmgDownloadUrl("0.2.14", "arm64", "https://releases.test")).toBe(
      "https://releases.test/v0.2.14/aop-macos-arm64.dmg",
    );
    expect(buildMacosDmgDownloadUrl("0.2.14", "x64", "https://releases.test/")).toBe(
      "https://releases.test/v0.2.14/aop-macos-x64.dmg",
    );
  });

  test("verifyMacosDmgDownload checks the public release asset before quitting the app", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      verifyMacosDmgDownload("https://releases.test/v0.2.14/aop-macos-arm64.dmg", "0.2.14"),
    ).rejects.toThrow("macOS update asset is not available yet for AOP 0.2.14");
  });

  test("verifyReleaseAsset reports network failures with the asset label", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(
      verifyReleaseAsset(
        "https://releases.test/v0.2.2/aop-linux-x64",
        "0.2.2",
        "aop-linux-x64 release asset",
      ),
    ).rejects.toThrow(
      "Could not verify the AOP 0.2.2 aop-linux-x64 release asset: connect ECONNREFUSED",
    );
  });

  test("buildMacosAppUpgradeScript installs the DMG app bundle and relaunches AOP", () => {
    const script = buildMacosAppUpgradeScript({
      appBundlePath: "/Applications/AOP.app",
      dmgUrl: "https://releases.test/v0.2.14/aop-macos-arm64.dmg",
      targetVersion: "0.2.14",
    });

    expect(script).toContain("download_dmg()");
    expect(script).toContain('curl -fL "$AOP_DMG_URL" -o "$AOP_DMG_PATH"');
    expect(script).toContain("sleep 5");
    expect(script).toContain('hdiutil attach "$AOP_DMG_PATH"');
    expect(script).toContain('ditto "$AOP_MOUNT_DIR/AOP.app" "$AOP_STAGE"');
    expect(script.indexOf('ditto "$AOP_MOUNT_DIR/AOP.app" "$AOP_STAGE"')).toBeLessThan(
      script.indexOf('tell application id "com.getaop.aop" to quit'),
    );
    expect(script).toContain('mv "$AOP_APP_BUNDLE" "$AOP_BACKUP"');
    expect(script).toContain('mv "$AOP_STAGE" "$AOP_APP_BUNDLE"');
    expect(script).toContain('open "$AOP_APP_BUNDLE"');
    expect(script).not.toContain('open "$AOP_DMG_URL"');
  });

  test("isRunningInsideSystemdUnit matches only systemd unit cgroups", () => {
    expect(
      isRunningInsideSystemdUnit(
        "0::/user.slice/user-1000.slice/user@1000.service/app.slice/aop-local-server.service",
      ),
    ).toBe(true);
    expect(
      isRunningInsideSystemdUnit(
        "0::/user.slice/user-1000.slice/user@1000.service/app.slice/session-1.scope",
      ),
    ).toBe(false);
    expect(isRunningInsideSystemdUnit("0::/")).toBe(false);
    expect(isRunningInsideSystemdUnit("0::/docker/abc123")).toBe(false);
  });

  test("buildUpgradeSpawnCommand runs the script in its own systemd unit when the server is a systemd service", async () => {
    const command = await buildUpgradeSpawnCommand("/home/u/.aop/upgrade.sh", {
      platform: "linux",
      cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/aop-local-server.service",
      hasSystemdRun: () => "/usr/bin/systemd-run",
      home: "/home/u",
      path: "/usr/bin:/bin",
    });

    expect(command).toEqual([
      "systemd-run",
      "--user",
      "--collect",
      "--setenv",
      "HOME=/home/u",
      "--setenv",
      "PATH=/usr/bin:/bin",
      "--working-directory",
      "/home/u",
      "sh",
      "/home/u/.aop/upgrade.sh",
    ]);
  });

  test("buildUpgradeSpawnCommand falls back to a plain sh spawn outside a systemd unit", async () => {
    expect(
      await buildUpgradeSpawnCommand("/home/u/.aop/upgrade.sh", {
        platform: "linux",
        cgroup: "0::/",
        hasSystemdRun: () => "/usr/bin/systemd-run",
        home: "/home/u",
        path: "/usr/bin:/bin",
      }),
    ).toEqual(["sh", "/home/u/.aop/upgrade.sh"]);
  });

  test("buildUpgradeSpawnCommand falls back to a plain sh spawn when systemd-run is unavailable", async () => {
    expect(
      await buildUpgradeSpawnCommand("/home/u/.aop/upgrade.sh", {
        platform: "linux",
        cgroup:
          "0::/user.slice/user-1000.slice/user@1000.service/app.slice/aop-local-server.service",
        hasSystemdRun: () => null,
        home: "/home/u",
        path: "/usr/bin:/bin",
      }),
    ).toEqual(["sh", "/home/u/.aop/upgrade.sh"]);
  });

  test("buildUpgradeSpawnCommand never uses systemd-run on non-Linux platforms", async () => {
    expect(
      await buildUpgradeSpawnCommand("/home/u/.aop/upgrade.sh", {
        platform: "darwin",
        cgroup:
          "0::/user.slice/user-1000.slice/user@1000.service/app.slice/aop-local-server.service",
        hasSystemdRun: () => "/usr/bin/systemd-run",
        home: "/home/u",
        path: "/usr/bin:/bin",
      }),
    ).toEqual(["sh", "/home/u/.aop/upgrade.sh"]);
  });

  test("detects the explicit desktop-managed runtime marker", () => {
    expect(isDesktopManagedWsl({ AOP_DESKTOP_MANAGED_RUNTIME: "1" })).toBe(true);
    expect(isDesktopManagedWsl({ AOP_EXEC_HOST: "wsl:Ubuntu" })).toBe(true);
    expect(isDesktopManagedWsl({ AOP_EXEC_HOST: "native" })).toBe(false);
    expect(isDesktopManagedWsl({})).toBe(false);
  });

  test("startBinaryUpgrade directs managed-runtime users to update Desktop", async () => {
    process.env.AOP_DESKTOP_MANAGED_RUNTIME = "1";
    try {
      await expect(startBinaryUpgrade("0.3.2")).rejects.toThrow(/update AOP Desktop/i);
    } finally {
      delete process.env.AOP_DESKTOP_MANAGED_RUNTIME;
    }
  });

  describe("startBinaryUpgrade release asset preflight", () => {
    // Bun's homedir() does not re-read $HOME at call time, so spy on the side effects
    // (write, chmod, spawn) instead of redirecting writes into a temp home directory.
    const mockUpgradeSideEffects = () => {
      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 4242,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);
      const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);
      const shellSpy = spyOn(Bun, "$").mockImplementation((() => ({
        quiet: async () => undefined,
      })) as unknown as typeof Bun.$);

      return {
        spawnSpy,
        writeSpy,
        shellSpy,
        restore: () => {
          spawnSpy.mockRestore();
          writeSpy.mockRestore();
          shellSpy.mockRestore();
        },
      };
    };

    test("rejects with a friendly message and leaves the server untouched when an asset is missing", async () => {
      const headUrls: string[] = [];
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        headUrls.push(String(url));
        return new Response(null, { status: 404 });
      }) as unknown as typeof fetch;
      const sideEffects = mockUpgradeSideEffects();

      try {
        const binaryAsset = requiredReleaseAssetNames("linux", process.arch)[0];
        await expect(startBinaryUpgrade("9.9.9", "linux")).rejects.toThrow(
          `The ${binaryAsset} release asset is not available yet for AOP 9.9.9 (404). Try again in a minute.`,
        );
        expect(headUrls).toEqual([`https://releases.test/v9.9.9/${binaryAsset}`]);
        expect(sideEffects.writeSpy).not.toHaveBeenCalled();
        expect(sideEffects.spawnSpy).not.toHaveBeenCalled();
      } finally {
        sideEffects.restore();
      }
    });

    test("verifies every asset with HEAD, then writes and spawns the upgrade script", async () => {
      const headRequests: { url: string; method: string | undefined }[] = [];
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        headRequests.push({ url: String(url), method: init?.method });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;
      const sideEffects = mockUpgradeSideEffects();

      try {
        const result = await startBinaryUpgrade("9.9.9", "linux", { cgroup: "0::/" });

        expect(result.status).toBe("started");
        expect(result.targetVersion).toBe("9.9.9");
        expect(headRequests).toEqual(
          requiredReleaseAssetNames("linux", process.arch).map((assetName) => ({
            url: `https://releases.test/v9.9.9/${assetName}`,
            method: "HEAD",
          })),
        );

        const scriptPath = join(homedir(), ".aop", "upgrade.sh");
        expect(sideEffects.writeSpy).toHaveBeenCalledTimes(1);
        expect(sideEffects.writeSpy.mock.calls[0]?.[0]).toBe(scriptPath);
        const script = String(sideEffects.writeSpy.mock.calls[0]?.[1]);
        expect(script).toContain(
          `preflight_asset "https://releases.test/v9.9.9/${requiredReleaseAssetNames("linux", process.arch)[0]}"`,
        );
        expect(sideEffects.spawnSpy).toHaveBeenCalledTimes(1);
        expect(sideEffects.spawnSpy.mock.calls[0]?.[0]).toEqual(["sh", scriptPath]);
      } finally {
        sideEffects.restore();
      }
    });

    test("spawns the upgrade script via systemd-run when the server runs inside a systemd unit", async () => {
      globalThis.fetch = mock(
        async () => new Response(null, { status: 200 }),
      ) as unknown as typeof fetch;
      const sideEffects = mockUpgradeSideEffects();

      try {
        await startBinaryUpgrade("9.9.9", "linux", {
          cgroup:
            "0::/user.slice/user-1000.slice/user@1000.service/app.slice/aop-local-server.service",
          hasSystemdRun: () => "/usr/bin/systemd-run",
          home: "/home/u",
          path: "/usr/bin:/bin",
        });

        const scriptPath = join(homedir(), ".aop", "upgrade.sh");
        expect(sideEffects.spawnSpy).toHaveBeenCalledTimes(1);
        expect(sideEffects.spawnSpy.mock.calls[0]?.[0]).toEqual([
          "systemd-run",
          "--user",
          "--collect",
          "--setenv",
          "HOME=/home/u",
          "--setenv",
          "PATH=/usr/bin:/bin",
          "--working-directory",
          "/home/u",
          "sh",
          scriptPath,
        ]);
      } finally {
        sideEffects.restore();
      }
    });
  });
});
