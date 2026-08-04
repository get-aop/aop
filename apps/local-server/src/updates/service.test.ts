import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  buildMacosAppUpgradeScript,
  buildMacosDmgDownloadUrl,
  buildUpgradeScript,
  buildWindowsUpgradeScript,
  fetchLatestReleaseVersion,
  isDesktopManagedWsl,
  isMacosAppBundleInstall,
  startBinaryUpgrade,
  verifyMacosDmgDownload,
} from "./service.ts";

const originalFetch = globalThis.fetch;
const originalEnv = process.env.AOP_RELEASES_URL;

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

  test("buildUpgradeScript clears a stale listener before starting the upgraded server", () => {
    const script = buildUpgradeScript({
      aopBinary: "/Users/test/.local/bin/aop",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
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
    expect(script.indexOf("wait_for_aop_port")).toBeLessThan(script.indexOf("curl -fsSL"));
    expect(script).not.toContain("run --background");
  });

  test("buildWindowsUpgradeScript frees the port via Get-NetTCPConnection without lsof/launchctl", () => {
    const script = buildWindowsUpgradeScript({
      aopBinary: "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe",
      releasesBaseUrl: "https://releases.test",
      targetVersion: "0.2.2",
    });

    expect(script).toContain("Get-NetTCPConnection -LocalPort $port -State Listen");
    expect(script).toContain("Stop-Process -Id $_.OwningProcess -Force");
    expect(script).toContain('& "C:\\Users\\test\\AppData\\Local\\aop\\aop.exe" stop');
    expect(script).toContain("https://releases.test/install.ps1");
    expect(script).toContain('-File $installer -Version "0.2.2"');
    expect(script).not.toContain("lsof");
    expect(script).not.toContain("launchctl");
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
});
