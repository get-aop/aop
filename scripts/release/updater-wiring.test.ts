import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RELEASE_REPO } from "@aop/common";
import { createElectronBuilderConfig } from "../desktop/electron-builder-config";
import { RELEASE_CHECKSUM_ARTIFACTS, RELEASE_UPDATER_FILES } from "./checksums";
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
    expect(RELEASE_UPDATER_FILES).toEqual(UPDATER_FILES);
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

  test("electron-builder writes the update feed for the same GitHub Releases the host reads", () => {
    const config = createElectronBuilderConfig({ version: "0.10.0", notarize: false });
    const [owner = "", repo = ""] = RELEASE_REPO.split("/");

    expect(config.publish).toEqual([{ provider: "github", owner, repo }]);
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
    for (const name of UPDATER_FILES) expect(RELEASE_CHECKSUM_ARTIFACTS).not.toContain(name);
  });

  test("the desktop app depends on electron-updater and the macOS switch is off", async () => {
    const desktop = await Bun.file(join(ROOT, "apps/desktop/package.json")).json();
    const policy = await readFile(
      join(ROOT, "apps/desktop/electron/updates/update-policy.ts"),
      "utf8",
    );

    expect(desktop.dependencies["electron-updater"]).toBeString();
    expect(policy).toContain("export const MAC_AUTO_UPDATE_ENABLED = false;");
  });
});
