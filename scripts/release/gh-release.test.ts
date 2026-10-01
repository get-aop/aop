import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGhReleaseArgs, buildGhUploadArgs, resolveReleaseAssets } from "./gh-release.ts";

describe("buildGhReleaseArgs", () => {
  test("builds gh release create args with the resolved artifacts", () => {
    const args = buildGhReleaseArgs("v0.2.20", "get-aop/aop-mono", [
      "/dist/release/aop-windows-x64-setup.exe",
      "/dist/release/checksums.sha256",
    ]);

    expect(args).toEqual([
      "release",
      "create",
      "v0.2.20",
      "--repo",
      "get-aop/aop-mono",
      "--title",
      "AOP v0.2.20",
      "--generate-notes",
      "/dist/release/aop-windows-x64-setup.exe",
      "/dist/release/checksums.sha256",
    ]);
  });

  test("publishes cleanly when no artifacts are present", () => {
    const args = buildGhReleaseArgs("v0.2.20", "get-aop/aop-mono", []);

    expect(args).toEqual([
      "release",
      "create",
      "v0.2.20",
      "--repo",
      "get-aop/aop-mono",
      "--title",
      "AOP v0.2.20",
      "--generate-notes",
    ]);
  });
});

describe("buildGhReleaseArgs with written notes", () => {
  test("uses the notes file instead of GitHub's guess", () => {
    const args = buildGhReleaseArgs("v0.2.20", "get-aop/aop-mono", [], "dist/release-notes.md");

    expect(args).toContain("--notes-file");
    expect(args).toContain("dist/release-notes.md");
    expect(args).not.toContain("--generate-notes");
  });
});

describe("buildGhUploadArgs", () => {
  test("attaches artifacts to an existing release, clobbering same-named assets", () => {
    const args = buildGhUploadArgs("v0.2.20", "get-aop/aop-mono", [
      "/dist/release/aop-windows-x64-setup.exe",
    ]);

    expect(args).toEqual([
      "release",
      "upload",
      "v0.2.20",
      "--repo",
      "get-aop/aop-mono",
      "--clobber",
      "/dist/release/aop-windows-x64-setup.exe",
    ]);
  });
});

describe("resolveReleaseAssets", () => {
  const namesIn = async (dir: string) =>
    (await resolveReleaseAssets(dir)).map((path) => path.slice(dir.length + 1));

  test("attaches the Windows updater files and the checksums when they exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-gh-release-"));
    try {
      for (const name of [
        "aop-windows-x64-setup.exe",
        "latest.yml",
        "aop-windows-x64-setup.exe.blockmap",
        "checksums.sha256",
      ]) {
        await writeFile(join(dir, name), name);
      }

      expect(await namesIn(dir)).toEqual([
        "aop-windows-x64-setup.exe",
        "latest.yml",
        "aop-windows-x64-setup.exe.blockmap",
        "checksums.sha256",
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("leaves them out of a release built without the Windows app", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-gh-release-"));
    try {
      await writeFile(join(dir, "aop-darwin-arm64"), "binary");

      expect(await namesIn(dir)).toEqual(["aop-darwin-arm64"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
