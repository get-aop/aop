import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bumpRootVersion, readRootVersion, setWorkspaceRootForTests } from "./bump-version.ts";

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

  test("updates only the root package.json version", async () => {
    await mkdir(join(tempRoot, "apps/cli"), { recursive: true });
    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(tempRoot, "apps/cli/package.json"),
      `${JSON.stringify({ name: "@aop/cli" }, null, 2)}\n`,
    );

    setWorkspaceRootForTests(tempRoot);
    const updatedPaths = await bumpRootVersion("0.2.0");

    expect(updatedPaths).toEqual(["package.json"]);

    const root = await Bun.file(join(tempRoot, "package.json")).json();
    expect(root.version).toBe("0.2.0");

    // Workspace files without a version are left untouched.
    const cli = await Bun.file(join(tempRoot, "apps/cli/package.json")).json();
    expect(cli.version).toBeUndefined();
  });

  test("returns no paths when the root is already at the target version", async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ version: "0.2.0" }, null, 2)}\n`,
    );

    setWorkspaceRootForTests(tempRoot);
    const updatedPaths = await bumpRootVersion("0.2.0");

    expect(updatedPaths).toEqual([]);
  });
});
