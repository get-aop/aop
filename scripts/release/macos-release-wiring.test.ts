import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const readReleaseWorkflow = (): Promise<string> =>
  readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");

describe("release wiring", () => {
  test("exposes package scripts for local DMG and Windows installer builds", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json();

    expect(pkg.scripts["package:macos-dmg"]).toBe("bun run ./scripts/release/macos-dmg.ts");
    expect(pkg.scripts["package:windows"]).toBe("bun run ./scripts/release/windows-installer.ts");
    expect(pkg.scripts["release:local"]).toBe("bun run ./scripts/release/local-publish.ts");
  });

  test("uses the desktop package version for Tauri bundles", async () => {
    const tauriConfig = await Bun.file(join(ROOT, "apps/desktop/src-tauri/tauri.conf.json")).json();

    expect(tauriConfig.version).toBe("../package.json");
  });

  test("runs one tag-triggered release workflow with mac, windows, and core jobs", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    expect(releaseWorkflow).toContain("on:");
    expect(releaseWorkflow).toContain('tags:\n      - "v*"');
    expect(releaseWorkflow).toContain("workflow_dispatch:");
    expect(releaseWorkflow).toContain("package-macos:");
    expect(releaseWorkflow).toContain("package-windows:");
    expect(releaseWorkflow).toContain("build:");
    expect(releaseWorkflow).toContain("release:");
    expect(releaseWorkflow).not.toContain("[self-hosted, windows]");
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
  });

  test("packages the Windows NSIS installer on windows-latest", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    expect(releaseWorkflow).toContain("package-windows:");
    expect(releaseWorkflow).toContain("runs-on: windows-latest");
    expect(releaseWorkflow).toContain("- name: Prime Bun Linux cross-compile target");
    expect(releaseWorkflow).toContain("--compile --target=bun-linux-x64");
    expect(releaseWorkflow).toContain("bun run package:windows");
    expect(releaseWorkflow).toContain("aop-windows-x64-setup.exe");
  });

  test("assembles the GitHub Release from every job's artifacts and deploys to R2", async () => {
    const releaseWorkflow = await readReleaseWorkflow();

    const releaseIndex = releaseWorkflow.indexOf("  release:");
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
    expect(releaseWorkflow).toContain("Deploy to legacy SSH host");
  });

  test("removes the standalone self-hosted Windows workflow", async () => {
    const windowsWorkflow = Bun.file(join(ROOT, ".github/workflows/release-windows.yml"));
    expect(await windowsWorkflow.exists()).toBe(false);
  });

  test("generates a single checksums.sha256 centrally before publishing", async () => {
    const localPublisher = await readFile(join(ROOT, "scripts/release/local-publish.ts"), "utf8");

    expect(localPublisher).toContain('"./scripts/release/checksums.ts"');
  });

  test("publishes macOS immediately and Windows when its independent artifacts exist", async () => {
    const r2 = await readFile(join(ROOT, "scripts/release/deploy-r2.sh"), "utf8");
    const legacy = await readFile(join(ROOT, "scripts/release/deploy-getaop.sh"), "utf8");
    const releaseDirRef = "$" + "{RELEASE_DIR}";

    // Anchored to line start so a commented-out (# upload_...) line fails the test.
    expect(r2).toMatch(/^upload_artifact "aop-macos-x64\.dmg" "application\/x-apple-diskimage"/m);
    expect(r2).toMatch(
      /^upload_optional_artifact "aop-windows-x64-setup\.exe" "application\/octet-stream"/m,
    );
    expect(r2).toMatch(/^\s+upload_object "latest\/aop-windows-x64-setup\.exe"/m);
    expect(legacy).toContain(`"${releaseDirRef}/aop-macos-x64.dmg"`);
    expect(legacy).toContain(`"${releaseDirRef}/aop-windows-x64-setup.exe"`);
  });
});
