import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildElectronResourcePlan, prepareElectronResources } from "./prepare-electron-resources";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Electron desktop resources", () => {
  test("plans macOS resources in the Electron app directory", () => {
    expect(
      buildElectronResourcePlan({
        arch: "arm64",
        releaseDir: "dist/release",
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      binaryPath: join("/repo", "dist/release/aop-darwin-arm64"),
      resourcesDir: join("/repo", "apps/desktop/resources"),
      sidecarPath: join("/repo", "apps/desktop/resources/aop"),
    });
  });

  test("stages the native binary and extracted runtime assets on macOS", async () => {
    const root = await createReleaseFixture();
    const plan = buildElectronResourcePlan({ arch: "arm64", workspaceRoot: root });

    await prepareElectronResources(plan);

    expect(await readFile(plan.sidecarPath, "utf8")).toBe("native-binary");
    expect(await readFile(join(plan.resourcesDir, "dashboard/index.html"), "utf8")).toBe(
      "dashboard",
    );
  });

  test("stages the fingerprinted Linux runtime inputs on Windows", async () => {
    const root = await createReleaseFixture();
    const plan = buildElectronResourcePlan({
      arch: "x64",
      platform: "windows",
      workspaceRoot: root,
    });

    await prepareElectronResources(plan);

    expect((await readdir(plan.resourcesDir)).sort()).toEqual([
      ".gitkeep",
      "aop-linux-x64",
      "desktop-runtime.sha256",
      "runtime-assets.tar.gz",
    ]);
    expect(
      (await readFile(join(plan.resourcesDir, "desktop-runtime.sha256"), "utf8")).trim(),
    ).toMatch(/^[a-f0-9]{64}$/u);
  });
});

const createReleaseFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "aop-electron-resources-"));
  temporaryRoots.push(root);
  const releaseDir = join(root, "dist/release");
  const archiveRoot = join(root, "archive");
  await mkdir(join(archiveRoot, "dashboard"), { recursive: true });
  await mkdir(releaseDir, { recursive: true });
  await writeFile(join(releaseDir, "aop-darwin-arm64"), "native-binary");
  await writeFile(join(releaseDir, "aop-linux-x64"), "linux-binary");
  await writeFile(join(archiveRoot, "dashboard/index.html"), "dashboard");
  await Bun.$`tar -czf ${join(releaseDir, "runtime-assets.tar.gz")} -C ${archiveRoot} dashboard`.quiet();
  return root;
};
