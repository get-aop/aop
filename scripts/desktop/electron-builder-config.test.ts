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
      target: [{ target: "dmg", arch: ["x64", "arm64"] }],
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
});
