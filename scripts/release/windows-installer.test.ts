import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildSigntoolCommand,
  buildWindowsInstallerPlan,
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
      installerPath: join("/repo", "dist/release/aop-windows-x64-setup.exe"),
      releaseDir: join("/repo", "dist/release"),
      resourcesDir: join("/repo", "apps/desktop/src-tauri/resources"),
      runtimeAssetsArchive: join("/repo", "dist/release/runtime-assets.tar.gz"),
      targetTriple: "x86_64-pc-windows-msvc",
      tauriBundleDir: join(
        "/repo",
        "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
      ),
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

  test("builds a SHA-256, timestamped signtool command", () => {
    expect(
      buildSigntoolCommand("C:/out/aop-windows-x64-setup.exe", "C:/tmp/cert.pfx", "pw"),
    ).toEqual([
      "signtool",
      "sign",
      "/fd",
      "sha256",
      "/f",
      "C:/tmp/cert.pfx",
      "/p",
      "pw",
      "/tr",
      "http://timestamp.digicert.com",
      "/td",
      "sha256",
      "C:/out/aop-windows-x64-setup.exe",
    ]);
  });
});
