import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildWindowsInstallerPlan,
  electronBuilderWindowsSigningEnv,
  parseWindowsSigningConfig,
  resolveWindowsInstallerArtifacts,
} from "./windows-installer.ts";

describe("windows-installer release planning", () => {
  test("names the NSIS installer distinctly from the bare CLI binary", () => {
    expect(resolveWindowsInstallerArtifacts()).toEqual(["aop-windows-x64-setup.exe"]);
  });

  test("builds bundle paths from the release directory and version", () => {
    const plan = buildWindowsInstallerPlan({
      releaseDir: "dist/release",
      version: "0.2.11",
      workspaceRoot: "/repo",
    });

    expect(plan).toEqual({
      appName: "AOP",
      builderInstallerPath: join("/repo", "dist/electron-builder/aop-windows-x64-setup.exe"),
      builderOutputDir: join("/repo", "dist/electron-builder"),
      installerPath: join("/repo", "dist/release/aop-windows-x64-setup.exe"),
      releaseDir: join("/repo", "dist/release"),
      version: "0.2.11",
      workspaceRoot: "/repo",
    });
  });
});

describe("windows-installer signing config", () => {
  test("keeps unsigned builds available when no PFX is supplied", () => {
    expect(parseWindowsSigningConfig({})).toEqual({ mode: "unsigned" });
  });

  test("enables signing when a base64 PFX and password are supplied", () => {
    expect(
      parseWindowsSigningConfig({
        AOP_WINDOWS_PFX_BASE64: "cGZ4LWJ5dGVz",
        AOP_WINDOWS_PFX_PASSWORD: "secret",
      }),
    ).toEqual({ mode: "signed", pfxBase64: "cGZ4LWJ5dGVz", password: "secret" });
  });

  test("requires a password when a PFX is supplied", () => {
    expect(() => parseWindowsSigningConfig({ AOP_WINDOWS_PFX_BASE64: "cGZ4LWJ5dGVz" })).toThrow(
      "AOP_WINDOWS_PFX_BASE64 requires AOP_WINDOWS_PFX_PASSWORD",
    );
  });

  test("passes the certificate to Electron Builder for app and installer signing", () => {
    expect(
      electronBuilderWindowsSigningEnv({ mode: "signed", pfxBase64: "base64-pfx", password: "pw" }),
    ).toEqual({ WIN_CSC_LINK: "base64-pfx", WIN_CSC_KEY_PASSWORD: "pw" });
    expect(electronBuilderWindowsSigningEnv({ mode: "unsigned" })).toEqual({
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    });
  });
});
