import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  test("plans the Mac app's resources in the Electron app directory", () => {
    expect(
      buildElectronResourcePlan({
        arch: "arm64",
        releaseDir: "dist/release",
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      binaryPath: join("/repo", "dist/release/aop-darwin-arm64"),
      resourcesDir: join("/repo", "apps/desktop/resources"),
      hostServerPath: join("/repo", "apps/desktop/resources/aop"),
    });
  });

  test("stages the host server and the dashboard files it serves", async () => {
    const root = await createReleaseFixture();
    const plan = buildElectronResourcePlan({ arch: "arm64", workspaceRoot: root });

    await prepareElectronResources(plan);

    expect(await readFile(plan.hostServerPath, "utf8")).toBe("native-binary");
    expect((await stat(plan.hostServerPath)).mode & 0o111).not.toBe(0);
    expect(await readFile(join(plan.resourcesDir, "dashboard/index.html"), "utf8")).toBe(
      "dashboard",
    );
  });

  test("stages nothing a Windows client would need: no Linux server, no WSL runtime", async () => {
    const root = await createReleaseFixture();
    const plan = buildElectronResourcePlan({ arch: "arm64", workspaceRoot: root });

    await prepareElectronResources(plan);

    expect((await readdir(plan.resourcesDir)).sort()).toEqual([".gitkeep", "aop", "dashboard"]);
  });

  test("says which input is missing", async () => {
    const root = await createReleaseFixture();
    await rm(join(root, "dist/release/aop-darwin-arm64"));

    await expect(
      prepareElectronResources(buildElectronResourcePlan({ arch: "arm64", workspaceRoot: root })),
    ).rejects.toThrow("Host server binary not found");
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
  await writeFile(join(archiveRoot, "dashboard/index.html"), "dashboard");
  await Bun.$`tar -czf ${join(releaseDir, "runtime-assets.tar.gz")} -C ${archiveRoot} dashboard`.quiet();
  return root;
};
