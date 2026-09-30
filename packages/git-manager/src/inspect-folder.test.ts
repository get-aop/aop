import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { inspectGitFolder } from "./inspect-folder.ts";
import { cleanupTestRepos, createTestRepo, TEST_BASE_DIR } from "./test-utils.ts";

afterAll(cleanupTestRepos);

const uniqueDir = (prefix: string): string =>
  join(TEST_BASE_DIR, `${prefix}-${crypto.randomUUID().slice(0, 6)}`);

const linkedWorktree = async (repo: string, branch: string): Promise<string> => {
  const path = uniqueDir("wt");
  await Bun.$`git worktree add -b ${branch} ${path}`.cwd(repo).quiet();
  return path;
};

describe("inspectGitFolder", () => {
  test("a normal repository is a repository with no main checkout to point at", async () => {
    const repo = await createTestRepo();
    expect(await inspectGitFolder(repo)).toEqual({ kind: "repository", mainRepoPath: null });
  });

  test("a linked worktree is a worktree and names the repository that owns it", async () => {
    const repo = await createTestRepo();
    const worktree = await linkedWorktree(repo, "feature");

    const folder = await inspectGitFolder(worktree);

    expect(folder.kind).toBe("worktree");
    expect(await realpath(folder.mainRepoPath ?? "")).toBe(await realpath(repo));
  });

  test("a plain folder, a folder inside a repository and a missing folder are not repositories", async () => {
    const repo = await createTestRepo();
    const inner = join(repo, "src");
    await mkdir(inner);

    expect((await inspectGitFolder(inner)).kind).toBeNull();
    expect((await inspectGitFolder(uniqueDir("missing"))).kind).toBeNull();
  });

  test("a .git file that points nowhere is not a repository", async () => {
    const folder = uniqueDir("broken");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, ".git"), "gitdir: /nonexistent/.git/worktrees/gone\n");

    expect(await inspectGitFolder(folder)).toEqual({ kind: null, mainRepoPath: null });
  });

  test("a .git file with no gitdir line, and an emptied .git folder, are not repositories", async () => {
    const garbage = uniqueDir("garbage");
    const emptied = uniqueDir("emptied");
    await mkdir(garbage, { recursive: true });
    await mkdir(join(emptied, ".git"), { recursive: true });
    await writeFile(join(garbage, ".git"), "not a pointer\n");

    expect((await inspectGitFolder(garbage)).kind).toBeNull();
    expect((await inspectGitFolder(emptied)).kind).toBeNull();
  });

  test("a worktree whose repository was deleted is not a repository", async () => {
    const repo = await createTestRepo();
    const worktree = await linkedWorktree(repo, "orphan");
    await rm(join(repo, ".git"), { recursive: true, force: true });

    expect((await inspectGitFolder(worktree)).kind).toBeNull();
  });

  test("a relative gitdir pointer is resolved against the folder", async () => {
    const repo = await createTestRepo();
    const worktree = await linkedWorktree(repo, "relative");
    const gitDir = (await Bun.$`git rev-parse --absolute-git-dir`.cwd(worktree).text()).trim();
    await writeFile(join(worktree, ".git"), `gitdir: ${relative(worktree, gitDir)}\n`);

    expect((await inspectGitFolder(worktree)).kind).toBe("worktree");
  });
});
