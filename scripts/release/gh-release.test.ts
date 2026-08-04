import { describe, expect, test } from "bun:test";
import { buildGhReleaseArgs, buildGhUploadArgs } from "./gh-release.ts";

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
