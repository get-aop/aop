import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTauriSidecarResourcePlan,
  prepareTauriSidecarResources,
} from "./prepare-tauri-sidecar.ts";

describe("buildTauriSidecarResourcePlan", () => {
  test("maps a macOS release binary and runtime archive into the Tauri resources directory", () => {
    expect(
      buildTauriSidecarResourcePlan({
        arch: "arm64",
        releaseDir: "dist/release",
        workspaceRoot: "/repo",
      }),
    ).toEqual({
      arch: "arm64",
      binaryPath: join("/repo", "dist/release/aop-darwin-arm64"),
      platform: "darwin",
      resourcesDir: join("/repo", "apps/desktop/src-tauri/resources"),
      runtimeAssetsArchive: join("/repo", "dist/release/runtime-assets.tar.gz"),
      sidecarPath: join("/repo", "apps/desktop/src-tauri/resources/aop"),
    });
  });

  test("maps the Windows package to a managed Linux WSL runtime", () => {
    expect(
      buildTauriSidecarResourcePlan({
        arch: "x64",
        platform: "windows",
        releaseDir: "dist/release",
        workspaceRoot: "/repo",
      }),
    ).toEqual({
      arch: "x64",
      binaryPath: join("/repo", "dist/release/aop-linux-x64"),
      platform: "windows",
      resourcesDir: join("/repo", "apps/desktop/src-tauri/resources"),
      runtimeAssetsArchive: join("/repo", "dist/release/runtime-assets.tar.gz"),
      runtimeAssetsResource: join(
        "/repo",
        "apps/desktop/src-tauri/resources/runtime-assets.tar.gz",
      ),
      runtimeFingerprintResource: join(
        "/repo",
        "apps/desktop/src-tauri/resources/desktop-runtime.sha256",
      ),
      sidecarPath: join("/repo", "apps/desktop/src-tauri/resources/aop-linux-x64"),
    });
  });

  test("stages only the bundled Linux runtime inputs for Windows", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "aop-wsl-runtime-"));
    try {
      const releaseDir = join(workspaceRoot, "dist/release");
      await mkdir(releaseDir, { recursive: true });
      await writeFile(join(releaseDir, "aop-linux-x64"), "linux-binary");
      await writeFile(join(releaseDir, "runtime-assets.tar.gz"), "runtime-assets");

      const plan = buildTauriSidecarResourcePlan({
        arch: "x64",
        platform: "windows",
        releaseDir,
        workspaceRoot,
      });
      await prepareTauriSidecarResources(plan);

      expect((await readdir(plan.resourcesDir)).sort()).toEqual([
        ".gitkeep",
        "aop-linux-x64",
        "desktop-runtime.sha256",
        "runtime-assets.tar.gz",
      ]);
      expect(await readFile(plan.sidecarPath, "utf8")).toBe("linux-binary");
      expect(await readFile(plan.runtimeAssetsResource as string, "utf8")).toBe("runtime-assets");
      expect((await readFile(plan.runtimeFingerprintResource as string, "utf8")).trim()).toMatch(
        /^[a-f0-9]{64}$/,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
