import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import {
  cleanupStaleTaskDocSymlinksInWorktree,
  cleanupStaleWorktreeTaskDocSymlinks,
} from "./worktree-symlink-cleanup.ts";

describe("task-docs/worktree-symlink-cleanup", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = join(tmpdir(), `aop-symlink-cleanup-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("cleanupStaleTaskDocSymlinksInWorktree removes docs/tasks symlink only", async () => {
    const changePath = "docs/tasks/demo-task";
    const worktreePath = join(tmpdir(), `aop-worktree-${Date.now()}`);
    const targetDir = join(tmpdir(), `aop-target-${Date.now()}`);
    await mkdir(join(worktreePath, "docs", "tasks"), { recursive: true });
    await mkdir(targetDir, { recursive: true });
    const symlinkPath = join(worktreePath, changePath);
    await symlink(targetDir, symlinkPath);

    await cleanupStaleTaskDocSymlinksInWorktree(worktreePath, changePath);

    expect(existsSync(symlinkPath)).toBe(false);
    expect(existsSync(targetDir)).toBe(true);
  });

  test("cleanupStaleWorktreeTaskDocSymlinks scans registered repo worktrees", async () => {
    const taskId = "task-1";
    const worktreeRoot = aopPaths.worktree("repo-1", taskId);
    await mkdir(join(worktreeRoot, "docs", "tasks", "legacy-task"), { recursive: true });
    const targetDir = join(tmpdir(), `aop-target-${Date.now()}`);
    await mkdir(targetDir, { recursive: true });
    const symlinkPath = join(worktreeRoot, "docs", "tasks", "legacy-task");
    await rm(symlinkPath, { recursive: true, force: true });
    await symlink(targetDir, symlinkPath);

    const removed = await cleanupStaleWorktreeTaskDocSymlinks(ctx.repoRepository);

    expect(removed).toBe(1);
    expect(existsSync(symlinkPath)).toBe(false);
  });
});
