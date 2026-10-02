import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElectronBuilderConfig } from "../desktop/electron-builder-config";
import {
  RELEASE_CHECKSUM_ARTIFACTS,
  RELEASE_UPDATER_FILES,
  WINDOWS_UPDATER_FILES,
} from "./checksums";
import { MAC_UPDATER_FILES } from "./macos-updater";
import { resolveWindowsInstallerArtifacts } from "./windows-installer";

const ROOT = join(import.meta.dirname, "../..");
const INSTALLER = "aop-windows-x64-setup.exe";
const UPDATER_FILES = ["latest.yml", `${INSTALLER}.blockmap`];

const readWorkflow = (): Promise<string> =>
  readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");

/** The text of one job, from its key to the next job's key. */
const job = (workflow: string, name: string): string => {
  const start = workflow.indexOf(`\n  ${name}:`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
};

describe("Windows app updater wiring", () => {
  test("the same two files are named by the packager, the release lists and the workflow", async () => {
    expect(WINDOWS_UPDATER_FILES).toEqual(UPDATER_FILES);
    expect(resolveWindowsInstallerArtifacts()).toEqual([INSTALLER, ...UPDATER_FILES]);

    const workflow = await readWorkflow();
    for (const name of UPDATER_FILES) {
      // uploaded by package-windows, required and kept by assemble, attached to the release
      for (const jobName of ["package-windows", "assemble", "release"]) {
        expect(job(workflow, jobName)).toContain(`\n            dist/release/${name}\n`);
      }
      expect(job(workflow, "assemble")).toContain(name);
    }
  });

  test("the packaging job uploads them and the Windows build still never publishes", async () => {
    const workflow = await readWorkflow();
    const windows = job(workflow, "package-windows");
    const packager = await readFile(join(ROOT, "scripts/release/windows-installer.ts"), "utf8");

    for (const name of UPDATER_FILES) expect(windows).toContain(`dist/release/${name}`);
    expect(packager).toContain('"--publish",\n      "never"');
  });

  test("electron-builder points the installed app at getaop.com/latest/, where deploy-r2 puts latest.yml", async () => {
    const config = createElectronBuilderConfig({ version: "0.10.0", notarize: false });
    const r2 = await readFile(join(ROOT, "scripts/release/deploy-r2.sh"), "utf8");

    // The repository is private, so GitHub Releases cannot be the feed of an installed app.
    expect(config.publish).toEqual([{ provider: "generic", url: "https://getaop.com/latest/" }]);
    expect(r2).toMatch(/^ {2}upload_feed_document "latest\/latest\.yml"/m);
    expect(r2).toMatch(/^upload_optional_artifact "aop-windows-x64-setup\.exe\.blockmap"/m);
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
  });

  test("assemble prints latest.yml and fails on the wrong version, file or hash", async () => {
    const assemble = job(await readWorkflow(), "assemble");

    expect(assemble).toContain("Check the Windows updater config");
    expect(assemble).toContain("cat dist/release/latest.yml");
    expect(assemble).toContain("needs.build.outputs.version");
    expect(assemble).toContain("^path: aop-windows-x64-setup.exe$");
    expect(assemble).toContain("openssl dgst -sha512");
  });

  test("the updater files stay out of the checksums, which only install.sh reads", () => {
    for (const name of RELEASE_UPDATER_FILES)
      expect(RELEASE_CHECKSUM_ARTIFACTS).not.toContain(name);
  });

  test("the desktop app depends on electron-updater", async () => {
    const desktop = await Bun.file(join(ROOT, "apps/desktop/package.json")).json();

    expect(desktop.dependencies["electron-updater"]).toBeString();
  });
});

describe("macOS app updater wiring", () => {
  test("the packager writes the zips and latest-mac.yml the workflow carries to the release", async () => {
    expect(MAC_UPDATER_FILES).toEqual([
      "latest-mac.yml",
      "aop-macos-x64.zip",
      "aop-macos-arm64.zip",
    ]);
    expect(RELEASE_UPDATER_FILES).toEqual([...WINDOWS_UPDATER_FILES, ...MAC_UPDATER_FILES]);

    const workflow = await readWorkflow();
    for (const name of MAC_UPDATER_FILES) {
      // uploaded by package-macos, required and kept by assemble, attached to the release
      for (const jobName of ["package-macos", "assemble", "release"]) {
        expect(job(workflow, jobName)).toContain(`\n            dist/release/${name}\n`);
      }
    }
    const packager = await readFile(join(ROOT, "scripts/release/macos-dmg.ts"), "utf8");
    expect(packager).toContain('"--mac",\n      "dmg",\n      "zip",');
    expect(packager).toContain("writeLatestMacYml(");
  });

  test("assemble requires the files and checks latest-mac.yml against this run's zips", async () => {
    const assemble = job(await readWorkflow(), "assemble");

    expect(assemble).toContain("aop-macos-x64.zip aop-macos-arm64.zip latest-mac.yml; do");
    expect(assemble).toContain("Check the macOS updater config");
    expect(assemble).toMatch(
      /bun run \.\/scripts\/release\/macos-updater\.ts check --dir dist\/release --version "\$\{\{ needs\.build\.outputs\.version \}\}"/,
    );
  });

  test("deploy-r2 puts the zips under vX.Y.Z/ and flips latest/latest-mac.yml with the other pointers", async () => {
    const r2 = await readFile(join(ROOT, "scripts/release/deploy-r2.sh"), "utf8");

    expect(r2).toMatch(/^upload_optional_artifact "aop-macos-x64\.zip"/m);
    expect(r2).toMatch(/^upload_optional_artifact "aop-macos-arm64\.zip"/m);
    expect(r2).toMatch(/^ {2}upload_feed_document "latest\/latest-mac\.yml"/m);
  });

  test("the app updates itself only when it is Developer ID signed, with no switch to flip", async () => {
    const main = await readFile(join(ROOT, "apps/desktop/electron/main.ts"), "utf8");

    expect(main).toMatch(
      /macSigned:\s+process\.platform === "darwin" &&\s+app\.isPackaged &&\s+\(await isDeveloperIdSigned\(appBundleOf\(app\.getPath\("exe"\)\)\)\)/,
    );
  });
});
