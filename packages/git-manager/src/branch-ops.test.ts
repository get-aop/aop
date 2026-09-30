import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BranchOps } from "./branch-ops.ts";
import { GitExecutor } from "./git-executor.ts";
import { cleanupTestRepos, createTestRepo } from "./test-utils.ts";

describe("BranchOps", () => {
  let repoPath: string;
  let branchOps: BranchOps;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    const executor = new GitExecutor(repoPath);
    branchOps = new BranchOps(executor);
  });

  afterEach(async () => {
    await cleanupTestRepos();
  });

  describe("exists", () => {
    test("returns true for existing branch", async () => {
      expect(await branchOps.exists("main")).toBe(true);
    });

    test("returns false for non-existing branch", async () => {
      expect(await branchOps.exists("nonexistent")).toBe(false);
    });

    test("returns false for a remote-tracking branch", async () => {
      await Bun.$`git update-ref refs/remotes/origin/main HEAD`.cwd(repoPath).quiet();

      expect(await branchOps.exists("origin/main")).toBe(false);
    });
  });

  describe("isStartPoint", () => {
    test("accepts a local branch and a remote-tracking branch", async () => {
      await Bun.$`git update-ref refs/remotes/origin/main HEAD`.cwd(repoPath).quiet();

      expect(await branchOps.isStartPoint("main")).toBe(true);
      expect(await branchOps.isStartPoint("origin/main")).toBe(true);
    });

    test("refuses a ref that is neither, such as a tag or a missing remote-tracking branch", async () => {
      await Bun.$`git tag v1`.cwd(repoPath).quiet();

      expect(await branchOps.isStartPoint("v1")).toBe(false);
      expect(await branchOps.isStartPoint("origin/main")).toBe(false);
    });
  });

  describe("getCommit", () => {
    test("returns commit SHA for branch", async () => {
      const sha = await branchOps.getCommit("main");
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
    });

    test("throws for non-existing ref", async () => {
      await expect(branchOps.getCommit("nonexistent")).rejects.toThrow();
    });
  });

  describe("listLocal", () => {
    test("lists all local branches and current branch", async () => {
      await Bun.$`git branch feature-a`.cwd(repoPath).quiet();
      await Bun.$`git branch feature-b`.cwd(repoPath).quiet();

      const result = await branchOps.listLocal();

      expect(result.branches).toContain("main");
      expect(result.branches).toContain("feature-a");
      expect(result.branches).toContain("feature-b");
      expect(result.current).toBe("main");
    });

    test("reflects current branch after checkout", async () => {
      await Bun.$`git branch feature`.cwd(repoPath).quiet();
      await Bun.$`git checkout feature`.cwd(repoPath).quiet();

      const result = await branchOps.listLocal();

      expect(result.current).toBe("feature");
    });
  });

  describe("getDefaultBranch", () => {
    test("returns main when main branch exists", async () => {
      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("main");
    });

    test("returns master when only master exists", async () => {
      // Rename main to master
      await Bun.$`git branch -m main master`.cwd(repoPath).quiet();

      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("master");
    });

    test("returns current branch when neither main nor master exists", async () => {
      // Rename main to something else and switch to it
      await Bun.$`git branch -m main develop`.cwd(repoPath).quiet();

      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("develop");
    });
  });
});
