import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const readReleaseWorkflow = (): Promise<string> =>
  readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");

// A tag push, or a dispatch that turned "publish" on. Pull requests and build-only dispatches are not.
const PUBLISHING_RUN =
  "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.publish)";

describe("release wiring", () => {
  test("exposes package scripts for local DMG and Windows desktop installer builds", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json();

    expect(pkg.scripts["package:macos-dmg"]).toBe("bun run ./scripts/release/macos-dmg.ts");
    expect(pkg.scripts["package:windows"]).toBe("bun run ./scripts/release/windows-installer.ts");
    expect(pkg.scripts["release:local"]).toBe("bun run ./scripts/release/local-publish.ts");
  });

  test("uses the Electron entry point and root package version", async () => {
    const desktopPackage = await Bun.file(join(ROOT, "apps/desktop/package.json")).json();
    const builderConfig = await readFile(
      join(ROOT, "scripts/desktop/electron-builder-config.ts"),
      "utf8",
    );

    expect(desktopPackage.main).toBe("dist-electron/main.cjs");
    expect(builderConfig).toContain('import packageInfo from "../../package.json"');
  });

  test("runs one release workflow with host, mac, windows, assemble and release jobs", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    expect(releaseWorkflow).toContain("on:");
    expect(releaseWorkflow).toContain('tags:\n      - "v*"');
    expect(releaseWorkflow).toContain("workflow_dispatch:");
    expect(releaseWorkflow).toContain("package-macos:");
    expect(releaseWorkflow).toContain("package-windows:");
    expect(releaseWorkflow).toContain("build:");
    expect(releaseWorkflow).toContain("assemble:");
    expect(releaseWorkflow).toContain("release:");
    expect(releaseWorkflow).not.toContain("[self-hosted, windows]");
  });

  test("builds every artifact on a pull request or a build-only dispatch but publishes only from a tag or a publish dispatch", async () => {
    const releaseWorkflow = await readReleaseWorkflow();
    const releaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf("\n  release:"));

    expect(releaseWorkflow).toContain("pull_request:");
    // A dispatch builds only, unless the person turns "publish" on.
    expect(releaseWorkflow).toMatch(
      /workflow_dispatch:\n {4}inputs:[\s\S]*?publish:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false/,
    );
    expect(releaseJob).toContain(`if: ${PUBLISHING_RUN}`);
    // Only the publishing job may write; everything a pull request reaches is read-only.
    expect(releaseWorkflow.match(/contents: write/g)).toHaveLength(1);
    expect(releaseJob).toContain("contents: write");
    expect(releaseWorkflow).toContain("permissions:\n  contents: read");
    // The cloud secrets exist only in the job that never runs for a build-only run.
    const beforeRelease = releaseWorkflow.slice(0, releaseWorkflow.indexOf("\n  release:"));
    expect(beforeRelease).not.toContain("CLOUDFLARE");
  });

  test("packages macOS with certificate import, signing, and notarization on macos-latest", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    expect(releaseWorkflow).toContain("package-macos:");
    expect(releaseWorkflow).toContain("runs-on: macos-latest");
    expect(releaseWorkflow).toContain("Import Apple Developer ID certificate");
    expect(releaseWorkflow).toContain("AOP_MACOS_CERTIFICATE_P12_BASE64");
    expect(releaseWorkflow).toContain("AOP_MACOS_SIGN_IDENTITY");
    expect(releaseWorkflow).toContain("AOP_MACOS_NOTARIZE");
    expect(releaseWorkflow).toContain("bun run package:macos-dmg");
    expect(releaseWorkflow).toContain("aop-macos-x64.dmg");
    expect(releaseWorkflow).toContain("aop-macos-arm64.dmg");
    expect(releaseWorkflow).not.toContain("rust-toolchain");
  });

  test("reads signing secrets only for a release with AOP_SIGN_RELEASES on, never for a pull request or a build-only dispatch", async () => {
    const releaseWorkflow = await readReleaseWorkflow();
    const secretLines = releaseWorkflow
      .split("\n")
      .filter((line) => /secrets\.(AOP_MACOS|APPLE|AOP_WINDOWS)/.test(line));

    const switchExpression = `{{ (${PUBLISHING_RUN}) && vars.AOP_SIGN_RELEASES == 'true' }}`;

    expect(releaseWorkflow.match(/SIGN_RELEASE: \$\{\{.*\}\}/g)).toEqual([
      `SIGN_RELEASE: $${switchExpression}`,
      `SIGN_RELEASE: $${switchExpression}`,
    ]);
    expect(secretLines.length).toBeGreaterThan(0);
    // Every signing secret is behind the switch, so a pull request build cannot notarize or sign.
    for (const line of secretLines) {
      expect(line).toContain("env.SIGN_RELEASE == 'true' &&");
    }
  });

  test("packages the Windows desktop client on windows-latest without a server build", async () => {
    const releaseWorkflow = await readReleaseWorkflow();
    const windowsJob = releaseWorkflow.slice(
      releaseWorkflow.indexOf("  package-windows:"),
      releaseWorkflow.indexOf("  assemble:"),
    );

    expect(windowsJob).toContain("runs-on: windows-latest");
    expect(windowsJob).toContain("bun run package:windows");
    expect(windowsJob).toContain("aop-windows-x64-setup.exe");
    expect(windowsJob).toContain("AOP_WINDOWS_PFX_BASE64");
    // Windows is a client: no host binaries are downloaded and nothing is cross-compiled.
    expect(windowsJob).not.toContain("release-binaries");
    expect(windowsJob).not.toContain("build:release");
    expect(windowsJob).not.toContain("--compile");
  });

  test("assembles the GitHub Release from the checked artifact set and deploys to R2", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    const releaseIndex = releaseWorkflow.indexOf("\n  release:");
    const r2Index = releaseWorkflow.indexOf("Deploy release assets to Cloudflare R2");
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(r2Index).toBeGreaterThan(releaseIndex);
    expect(releaseWorkflow).toContain("softprops/action-gh-release@v3.0.1");
    expect(releaseWorkflow).toContain("aop-linux-x64");
    expect(releaseWorkflow).toContain("aop-darwin-x64");
    expect(releaseWorkflow).toContain("aop-windows-x64-setup.exe");
    expect(releaseWorkflow).toContain("runtime-assets.tar.gz");
    expect(releaseWorkflow).toContain("checksums.sha256");
    expect(releaseWorkflow).toContain("bash scripts/release/deploy-r2.sh");
    expect(releaseWorkflow).toContain("CLOUDFLARE_API_TOKEN");
  });

  test("ships no Windows host, PowerShell installer, version feed or legacy SSH deploy", async () => {
    const releaseWorkflow = await readReleaseWorkflow();
    const pkg = await Bun.file(join(ROOT, "package.json")).json();

    // The assemble job names the file only to fail the build if it ever reappears.
    expect(releaseWorkflow).not.toContain("dist/release/aop-windows-x64.exe\n");
    expect(releaseWorkflow).toContain("Unexpected Windows host binary");
    expect(releaseWorkflow).not.toContain("install.ps1");
    expect(releaseWorkflow).not.toContain("latest/version");
    expect(releaseWorkflow).not.toContain("legacy SSH");
    expect(releaseWorkflow).not.toContain("GETAOP_DEPLOY");
    expect(await Bun.file(join(ROOT, "scripts/installer/install.ps1")).exists()).toBe(false);
    expect(await Bun.file(join(ROOT, "scripts/release/deploy-getaop.sh")).exists()).toBe(false);
    expect(pkg.scripts["build:release"]).toBeDefined();
  });

  test("removes the standalone self-hosted Windows workflow", async () => {
    const windowsWorkflow = Bun.file(join(ROOT, ".github/workflows/release-windows.yml"));
    expect(await windowsWorkflow.exists()).toBe(false);
  });

  test("generates a single checksums.sha256 centrally before publishing", async () => {
    const localPublisher = await readFile(join(ROOT, "scripts/release/local-publish.ts"), "utf8");

    expect(localPublisher).toContain('"./scripts/release/checksums.ts"');
  });

  test("publishes the desktop downloads and the stamped install script from R2", async () => {
    const r2 = await readFile(join(ROOT, "scripts/release/deploy-r2.sh"), "utf8");

    // Anchored to line start so a commented-out (# upload_...) line fails the test.
    expect(r2).toMatch(/^upload_artifact "aop-macos-x64\.dmg" "application\/x-apple-diskimage"/m);
    expect(r2).toMatch(
      /^upload_optional_artifact "aop-windows-x64-setup\.exe" "application\/octet-stream"/m,
    );
    expect(r2).toMatch(/^upload_latest_alias "aop-windows-x64-setup\.exe"/m);
    expect(r2).toMatch(/^upload_object "install\.sh"/m);
    expect(r2).not.toContain("latest/version");
    expect(r2).not.toContain("install.ps1");
    expect(r2).not.toContain("aop-windows-x64.exe");
  });
});
