import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupTestRepos, createTestRepo, TEST_BASE_DIR } from "@aop/git-manager/test-utils";
import { listDirectories } from "./handlers.ts";

afterAll(cleanupTestRepos);

const addWorktree = async (repo: string, name: string): Promise<string> => {
  const worktree = path.join(path.dirname(repo), name);
  await Bun.$`git worktree add -b ${name} ${worktree}`.cwd(repo).quiet();
  return worktree;
};

describe("listDirectories git detection", () => {
  test("a normal repository can be attached and is not a worktree", async () => {
    const repo = await createTestRepo();

    const result = await listDirectories(repo);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gitKind).toBe("repository");
    expect(result.data.worktreeOf).toBeNull();
  });

  test("a linked worktree can be attached and names the repository that owns it", async () => {
    const repo = await createTestRepo();
    const worktree = await addWorktree(repo, "feature-x");

    const result = await listDirectories(worktree);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gitKind).toBe("worktree");
    expect(await realpath(result.data.worktreeOf ?? "")).toBe(await realpath(repo));
  });

  test("a plain folder cannot be attached", async () => {
    const folder = path.join(TEST_BASE_DIR, "plain-folder");
    mkdirSync(folder, { recursive: true });

    const result = await listDirectories(folder);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gitKind).toBeNull();
    expect(result.data.worktreeOf).toBeNull();
  });

  test("a .git file that points nowhere cannot be attached", async () => {
    const folder = path.join(TEST_BASE_DIR, "broken");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, ".git"), "gitdir: /some/path/.git/worktrees/gone\n");

    const result = await listDirectories(folder);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gitKind).toBeNull();
  });

  test("marks the subfolders that are repositories or worktrees, and only those", async () => {
    const parent = path.join(TEST_BASE_DIR, "parent-folder");
    const repo = path.join(parent, "main");
    mkdirSync(repo, { recursive: true });
    await Bun.$`git init -b main && git -c user.name=Test -c user.email=test@test.com commit --allow-empty -m init`
      .cwd(repo)
      .quiet();
    await addWorktree(repo, "linked");
    mkdirSync(path.join(parent, "plain"));
    mkdirSync(path.join(parent, "broken"));
    writeFileSync(path.join(parent, "broken", ".git"), "gitdir: /nowhere\n");

    const result = await listDirectories(parent);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gitKind).toBeNull();
    expect(result.data.gitFolders).toEqual({
      main: "repository",
      linked: "worktree",
    });
  });
});

describe("listDirectories path forms", () => {
  test("expands ~ to the home folder", async () => {
    const result = await listDirectories("~");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.path).toBe(os.homedir());
  });

  test("lists a path written with a trailing slash as the folder itself", async () => {
    const folder = path.join(TEST_BASE_DIR, "trailing");
    mkdirSync(folder, { recursive: true });

    const result = await listDirectories(`${folder}/`);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.path).toBe(folder);
  });
});
