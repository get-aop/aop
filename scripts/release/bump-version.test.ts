import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bumpWorkspaceVersions,
  readRootVersion,
  setWorkspaceRootForTests,
} from "./bump-version.ts";

const tempRoot = join(import.meta.dirname, ".tmp-bump-version");

afterEach(async () => {
  setWorkspaceRootForTests(null);
  await rm(tempRoot, { recursive: true, force: true });
});

describe("bump-version", () => {
  test("reads the root package version", async () => {
    const rootPackage = await Bun.file(join(import.meta.dirname, "../../package.json")).json();
    await expect(readRootVersion()).resolves.toBe(rootPackage.version);
  });

  test("updates workspace package.json files to the same version", async () => {
    await mkdir(join(tempRoot, "apps/cli"), { recursive: true });
    await mkdir(join(tempRoot, "apps/desktop"), { recursive: true });
    await mkdir(join(tempRoot, "packages/common"), { recursive: true });
    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(tempRoot, "apps/cli/package.json"),
      `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(tempRoot, "apps/desktop/package.json"),
      `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(tempRoot, "packages/common/package.json"),
      `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`,
    );

    setWorkspaceRootForTests(tempRoot);
    const updatedPaths = await bumpWorkspaceVersions("0.2.0");

    expect(updatedPaths.sort()).toEqual([
      "apps/cli/package.json",
      "apps/desktop/package.json",
      "package.json",
      "packages/common/package.json",
    ]);

    const root = await Bun.file(join(tempRoot, "package.json")).json();
    expect(root.version).toBe("0.2.0");
  });
});
