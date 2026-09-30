import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { aopPaths, useTestAopHome } from "@aop/infra";
import {
  BranchNotFoundError,
  DirtyWorktreeError,
  NotAGitRepositoryError,
  WorktreeExistsError,
  WorktreeNotFoundError,
} from "./errors.ts";
import { GitManager } from "./git-manager.ts";
import { cleanupTestRepos, createTestRepo, TEST_BASE_DIR } from "./test-utils.ts";

const TEST_REPO_ID = "repo_test123";

describe("GitManager", () => {
  let repoPath: string;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    repoPath = await createTestRepo();
  });

  afterEach(async () => {
    await cleanupTestRepos();
    cleanupAopHome();
  });

  describe("init", () => {
    test("initializes successfully for valid git repository", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await expect(manager.init()).resolves.toBeUndefined();
    });

    test("throws NotAGitRepositoryError for non-git directory", async () => {
      const nonGitPath = `${TEST_BASE_DIR}/not-a-repo`;
      await Bun.$`mkdir -p ${nonGitPath}`.quiet();
      const manager = new GitManager({ repoPath: nonGitPath, repoId: TEST_REPO_ID });
      await expect(manager.init()).rejects.toThrow(NotAGitRepositoryError);
    });
  });

  describe("createWorktree", () => {
    test("creates worktree at global path", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const result = await manager.createWorktree("feat-auth", "main");

      expect(result.path).toBe(aopPaths.worktree(TEST_REPO_ID, "feat-auth"));
      expect(result.branch).toBe("feat-auth");
      expect(result.baseCommit).toMatch(/^[a-f0-9]{40}$/);

      const dirExists = await Bun.file(`${result.path}/README.md`).exists();
      expect(dirExists).toBe(true);
    });

    test("auto-initializes worktrees directory if missing", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const worktreesDir = aopPaths.worktrees(TEST_REPO_ID);
      const result = await Bun.$`test -d ${worktreesDir}`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("does not create .gitignore in repo", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const gitignoreExists = await Bun.file(`${repoPath}/.gitignore`).exists();
      expect(gitignoreExists).toBe(false);
    });

    test("throws WorktreeExistsError if worktree already exists", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");
      await expect(manager.createWorktree("feat-auth", "main")).rejects.toThrow(
        WorktreeExistsError,
      );
    });

    test("reattaches worktree when the task branch already exists without a worktree path", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const first = await manager.createWorktree("feat-auth", "main", "feat-auth");
      await Bun.$`git worktree remove --force ${first.path}`.cwd(repoPath).quiet();

      const second = await manager.createWorktree("feat-auth-retry", "main", "feat-auth");

      expect(second.path).toBe(aopPaths.worktree(TEST_REPO_ID, "feat-auth-retry"));
      expect(second.branch).toBe("feat-auth");
      expect(await Bun.file(`${second.path}/README.md`).exists()).toBe(true);
    });

    test("throws BranchNotFoundError if base branch does not exist", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("feat-auth", "nonexistent")).rejects.toThrow(
        BranchNotFoundError,
      );
      await expect(manager.createWorktree("feat-auth", "origin/main")).rejects.toThrow(
        BranchNotFoundError,
      );
    });

    test("starts a new branch at a remote-tracking base, records it, and gives it no upstream", async () => {
      const origin = `${TEST_BASE_DIR}/origin-${Date.now()}.git`;
      await Bun.$`git init -q --bare -b main ${origin}`.quiet();
      await Bun.$`git remote add origin ${origin}`.cwd(repoPath).quiet();
      await Bun.$`git push -q origin main`.cwd(repoPath).quiet();
      const published = (await Bun.$`git rev-parse main`.cwd(repoPath).text()).trim();
      await Bun.$`git commit -q --allow-empty -m unpushed`.cwd(repoPath).quiet();
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const result = await manager.createWorktree("feat-auth", "origin/main", "feat-auth");

      expect(result).toMatchObject({ baseBranch: "origin/main", baseCommit: published });
      expect((await Bun.$`git rev-parse HEAD`.cwd(result.path).text()).trim()).toBe(published);
      const upstream = await Bun.$`git rev-parse --verify feat-auth@{upstream}`
        .cwd(repoPath)
        .quiet()
        .nothrow();
      expect(upstream.exitCode).not.toBe(0);
    });

    test("rejects invalid taskId with path traversal", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("../../../etc", "main")).rejects.toThrow(
        "Invalid taskId",
      );
      await expect(manager.createWorktree("foo/../bar", "main")).rejects.toThrow("Invalid taskId");
    });

    test("rejects empty taskId", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("", "main")).rejects.toThrow("cannot be empty");
    });

    test("uses the provided branch name instead of the task id", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const result = await manager.createWorktree("task_auth_001", "main", "feat-auth");

      expect(result.path).toBe(aopPaths.worktree(TEST_REPO_ID, "task_auth_001"));
      expect(result.branch).toBe("feat-auth");

      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toContain("feat-auth");
    });
  });

  describe("removeWorktree", () => {
    test("removes clean worktree and its branch", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      expect(
        await Bun.$`test -d ${worktree.path}`
          .quiet()
          .nothrow()
          .then((r) => r.exitCode),
      ).toBe(0);

      await manager.removeWorktree("feat-auth");

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);

      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toBe("");
    });

    test("throws DirtyWorktreeError when worktree has uncommitted changes", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      await Bun.$`echo "uncommitted" > dirty.txt`.cwd(worktree.path).quiet();

      await expect(manager.removeWorktree("feat-auth")).rejects.toThrow(DirtyWorktreeError);

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).toBe(0);
    });

    test("throws WorktreeNotFoundError when worktree does not exist", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.removeWorktree("nonexistent")).rejects.toThrow(WorktreeNotFoundError);
    });
  });
});
