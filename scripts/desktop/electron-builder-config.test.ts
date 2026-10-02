import { describe, expect, test } from "bun:test";
import { createElectronBuilderConfig } from "./electron-builder-config";

describe("Electron Builder configuration", () => {
  test("packages only built app files plus external desktop resources", () => {
    const config = createElectronBuilderConfig({ version: "0.9.49", notarize: false });

    expect(config).toMatchObject({
      appId: "com.getaop.aop",
      productName: "AOP",
      electronVersion: "43.3.0",
      directories: { app: "apps/desktop", output: "dist/electron-builder" },
      extraMetadata: { main: "dist-electron/main.cjs", version: "0.9.49" },
      files: ["dist/**/*", "dist-electron/**/*", "package.json"],
      extraResources: [{ from: "apps/desktop/resources", to: ".", filter: ["**/*"] }],
    });
  });

  test("hardens Electron fuses and macOS runtime settings", () => {
    const config = createElectronBuilderConfig({ version: "0.9.49", notarize: true });

    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: false,
    });
    expect(config.mac).toMatchObject({
      category: "public.app-category.developer-tools",
      hardenedRuntime: true,
      notarize: true,
      // The zip is what an installed, signed app updates itself from.
      target: [
        { target: "dmg", arch: ["x64", "arm64"] },
        { target: "zip", arch: ["x64", "arm64"] },
      ],
    });
  });

  test("gives an unsigned macOS build an ad-hoc signature so Apple silicon can launch it", () => {
    const unsigned = createElectronBuilderConfig({
      version: "0.9.49",
      notarize: false,
      signed: false,
    });
    const signed = createElectronBuilderConfig({ version: "0.9.49", notarize: false });

    expect(unsigned.mac).toMatchObject({ identity: "-", hardenedRuntime: false });
    expect(signed.mac.identity).toBeUndefined();
    expect(signed.mac.hardenedRuntime).toBe(true);
  });

  test("keeps the Windows installer per-user and x64", () => {
    const config = createElectronBuilderConfig({ version: "0.9.49", notarize: false });

    expect(config.win).toMatchObject({ target: [{ target: "nsis", arch: ["x64"] }] });
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
  });

  test("a nightly build is a separate app with its own icon and feed", () => {
    const config = createElectronBuilderConfig({
      version: "0.10.7-nightly.20261002.14",
      notarize: true,
      channel: "nightly",
    });

    expect(config).toMatchObject({
      appId: "com.getaop.aop.nightly",
      productName: "AOP Nightly",
      extraMetadata: {
        name: "aop-nightly-desktop",
        productName: "AOP Nightly",
        version: "0.10.7-nightly.20261002.14",
      },
      publish: [{ provider: "generic", url: "https://getaop.com/nightly/latest/" }],
      detectUpdateChannel: false,
    });
    expect(config.mac.icon).toBe("apps/desktop/build/nightly/icon.icns");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands these placeholders.
    expect(config.dmg.title).toBe("AOP Nightly ${version} ${arch}");
    const stable = createElectronBuilderConfig({ version: "0.10.6", notarize: true });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands these placeholders.
    expect(stable.dmg.title).toBe("AOP ${version} ${arch}");
    expect(stable.mac.icon).toBe("apps/desktop/build/icon.icns");
    // Stable's app name, and with it its data folder, must not move.
    expect(stable.extraMetadata).not.toHaveProperty("name");
    expect(stable.extraMetadata).not.toHaveProperty("productName");
  });

  test("publishes a generic feed on getaop.com, so the Windows build writes latest.yml", () => {
    const config = createElectronBuilderConfig({ version: "0.9.49", notarize: false });

    expect(config.publish).toEqual([{ provider: "generic", url: "https://getaop.com/latest/" }]);
    expect(config.win.artifactName).toMatch(/^aop-windows-.+-setup\./);
  });
});
