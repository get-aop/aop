import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildCodesignCommand,
  buildDmgNotarizationCommands,
  buildMacDmgPlan,
  parseMacSigningConfig,
  resolveMacDmgArtifacts,
  targetTripleForArch,
} from "./macos-dmg.ts";

describe("macos-dmg release planning", () => {
  test("plans one DMG per darwin binary architecture", () => {
    expect(resolveMacDmgArtifacts()).toEqual(["aop-macos-x64.dmg", "aop-macos-arm64.dmg"]);
  });

  test("builds bundle paths from the release directory, version, and architecture", () => {
    const plan = buildMacDmgPlan({
      arch: "arm64",
      releaseDir: "dist/release",
      version: "0.2.7",
      workspaceRoot: "/repo",
    });

    expect(plan).toEqual({
      appName: "AOP.app",
      arch: "arm64",
      binaryPath: join("/repo", "dist/release/aop-darwin-arm64"),
      dmgPath: join("/repo", "dist/release/aop-macos-arm64.dmg"),
      releaseDir: join("/repo", "dist/release"),
      resourcesDir: join("/repo", "apps/desktop/src-tauri/resources"),
      runtimeAssetsArchive: join("/repo", "dist/release/runtime-assets.tar.gz"),
      targetTriple: "aarch64-apple-darwin",
      tauriBundleDir: join(
        "/repo",
        "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg",
      ),
      version: "0.2.7",
      volumeName: "AOP 0.2.7 arm64",
      workspaceRoot: "/repo",
    });
  });

  test("maps macOS release arches to Rust target triples", () => {
    expect(targetTripleForArch("arm64")).toBe("aarch64-apple-darwin");
    expect(targetTripleForArch("x64")).toBe("x86_64-apple-darwin");
  });
});

describe("macos-dmg signing config", () => {
  test("keeps unsigned builds available when Apple credentials are absent", () => {
    expect(parseMacSigningConfig({})).toEqual({ mode: "unsigned" });
  });

  test("enables signing when a Developer ID identity is supplied", () => {
    expect(
      parseMacSigningConfig({
        AOP_MACOS_SIGN_IDENTITY: "Developer ID Application: Example Inc (TEAM12345)",
      }),
    ).toEqual({
      mode: "signed",
      identity: "Developer ID Application: Example Inc (TEAM12345)",
      notarization: { enabled: false },
    });
  });

  test("requires all Apple credentials when notarization is requested", () => {
    expect(() =>
      parseMacSigningConfig({
        AOP_MACOS_NOTARIZE: "1",
        AOP_MACOS_SIGN_IDENTITY: "Developer ID Application: Example Inc (TEAM12345)",
        APPLE_ID: "dev@example.com",
      }),
    ).toThrow(
      "AOP_MACOS_NOTARIZE requires APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD",
    );
  });

  test("signs the bundled AOP sidecar with hardened runtime before notarization", () => {
    expect(
      buildCodesignCommand("/repo/dist/release/aop-darwin-arm64", {
        mode: "signed",
        identity: "Developer ID Application: Example Inc (TEAM12345)",
        notarization: { enabled: false },
      }),
    ).toEqual([
      "codesign",
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      "Developer ID Application: Example Inc (TEAM12345)",
      "/repo/dist/release/aop-darwin-arm64",
    ]);
  });

  test("does not codesign sidecars for unsigned local DMGs", () => {
    expect(buildCodesignCommand("/repo/dist/release/aop-darwin-arm64", { mode: "unsigned" })).toBe(
      undefined,
    );
  });

  test("notarizes and staples the finished DMG when notarization is enabled", () => {
    expect(
      buildDmgNotarizationCommands("/repo/dist/release/aop-macos-arm64.dmg", {
        mode: "signed",
        identity: "Developer ID Application: Example Inc (TEAM12345)",
        notarization: {
          enabled: true,
          appleId: "dev@example.com",
          appSpecificPassword: "app-password",
          teamId: "TEAM12345",
        },
      }),
    ).toEqual([
      [
        "xcrun",
        "notarytool",
        "submit",
        "/repo/dist/release/aop-macos-arm64.dmg",
        "--apple-id",
        "dev@example.com",
        "--password",
        "app-password",
        "--team-id",
        "TEAM12345",
        "--wait",
      ],
      ["xcrun", "stapler", "staple", "/repo/dist/release/aop-macos-arm64.dmg"],
      ["xcrun", "stapler", "validate", "/repo/dist/release/aop-macos-arm64.dmg"],
    ]);
  });

  test("does not notarize unsigned or signing-only DMGs", () => {
    expect(
      buildDmgNotarizationCommands("/repo/dist/release/aop-macos-arm64.dmg", {
        mode: "unsigned",
      }),
    ).toEqual([]);
    expect(
      buildDmgNotarizationCommands("/repo/dist/release/aop-macos-arm64.dmg", {
        mode: "signed",
        identity: "Developer ID Application: Example Inc (TEAM12345)",
        notarization: { enabled: false },
      }),
    ).toEqual([]);
  });
});
