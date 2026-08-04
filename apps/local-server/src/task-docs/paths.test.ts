import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { taskDocsExistOnDisk } from "./paths.ts";

describe("task-docs/paths", () => {
  let cleanupAopHome: (() => void) | undefined;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    repoPath = await mkdtemp(join(tmpdir(), "aop-task-paths-"));
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await rm(repoPath, { force: true, recursive: true });
  });

  test.each([
    "task.md",
    "issues.md",
    "prd.md",
    "plan.md",
  ])("treats %s as a task doc marker", async (filename) => {
    const taskDir = aopPaths.repoTask("repo-1", "auth-flow");
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, filename), "# Task doc");

    expect(taskDocsExistOnDisk("repo-1", repoPath, "auth-flow")).toBe(true);
  });
});
