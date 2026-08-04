import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { cleanupTaskArtifacts, deleteTaskDocsDir } from "./cleanup.ts";
import { getCanonicalTaskDir } from "./paths.ts";

describe("task-docs/cleanup", () => {
  let cleanupAopHome: (() => void) | undefined;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    repoPath = join(tmpdir(), `aop-cleanup-${Date.now()}`);
    await mkdir(repoPath, { recursive: true });
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("deleteTaskDocsDir removes canonical task folder", async () => {
    const taskDir = aopPaths.repoTask("repo-1", "demo-task");
    await mkdir(taskDir, { recursive: true });
    await Bun.write(join(taskDir, "task.md"), "# Task");

    await deleteTaskDocsDir(taskDir);

    expect(existsSync(taskDir)).toBe(false);
  });

  test("cleanupTaskArtifacts deletes docs and stale worktree symlinks", async () => {
    const taskId = "task-demo";
    const changePath = "docs/tasks/demo-task";
    const taskDir = getCanonicalTaskDir("repo-1", changePath);
    await mkdir(taskDir, { recursive: true });
    await Bun.write(join(taskDir, "task.md"), "# Task");

    const worktreePath = join(tmpdir(), `aop-worktree-${Date.now()}`);
    await mkdir(worktreePath, { recursive: true });
    const symlinkPath = join(worktreePath, changePath);
    await mkdir(join(worktreePath, "docs", "tasks"), { recursive: true });
    await symlink(taskDir, symlinkPath);

    await cleanupTaskArtifacts({
      repoId: "repo-1",
      repoPath,
      taskId,
      changePath,
      worktreePath,
    });

    expect(existsSync(taskDir)).toBe(false);
    expect(existsSync(symlinkPath)).toBe(false);
  });
});
