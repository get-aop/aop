import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestRepos, createTestRepo, TEST_BASE_DIR } from "@aop/git-manager/test-utils";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { initRepo } from "./handlers.ts";

describe("initRepo: which folders can be registered", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  afterAll(cleanupTestRepos);

  test("registers a normal repository under the path it was given", async () => {
    const repo = await createTestRepo();

    const result = await initRepo(ctx, repo);

    expect(result.success).toBe(true);
    expect((await ctx.repoRepository.getByPath(repo))?.path).toBe(repo);
  });

  test("registers a linked worktree under its own path, apart from the repository", async () => {
    const repo = await createTestRepo();
    const worktree = join(TEST_BASE_DIR, `linked-${crypto.randomUUID().slice(0, 6)}`);
    await Bun.$`git worktree add -b linked ${worktree}`.cwd(repo).quiet();

    const fromWorktree = await initRepo(ctx, worktree);
    const fromRepo = await initRepo(ctx, repo);

    expect(fromWorktree.success && fromRepo.success).toBe(true);
    if (!fromWorktree.success || !fromRepo.success) return;
    expect(fromWorktree.alreadyExists).toBe(false);
    expect(fromRepo.alreadyExists).toBe(false);
    expect(fromWorktree.repoId).not.toBe(fromRepo.repoId);
    expect((await ctx.repoRepository.getByPath(worktree))?.name).toBe(
      worktree.split("/").pop() ?? "",
    );
  });

  test("refuses a plain folder, a folder inside a repository and a missing folder", async () => {
    const repo = await createTestRepo();
    const inside = join(repo, "src");
    const plain = join(TEST_BASE_DIR, `plain-${crypto.randomUUID().slice(0, 6)}`);
    mkdirSync(inside);
    mkdirSync(plain, { recursive: true });

    for (const path of [plain, inside, join(plain, "missing")]) {
      const result = await initRepo(ctx, path);
      expect(result).toEqual({ success: false, error: { code: "NOT_A_GIT_REPO", path } });
    }
    expect(await ctx.repoRepository.getAll()).toEqual([]);
  });

  test("refuses a .git file that points at a repository that is gone", async () => {
    const folder = join(TEST_BASE_DIR, `broken-${crypto.randomUUID().slice(0, 6)}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".git"), "gitdir: /nonexistent/.git/worktrees/gone\n");

    const result = await initRepo(ctx, folder);

    expect(result).toEqual({ success: false, error: { code: "NOT_A_GIT_REPO", path: folder } });
  });
});
