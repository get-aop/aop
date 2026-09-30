import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { useTempAopHome } from "../project/test-utils.ts";
import { defaultRunGit } from "../session-git/service.ts";
import { attachBareOrigin, createRepo, git, gitSucceeds, writeWorkFile } from "./git-test-utils.ts";
import { chooseBranchName, ensureWorktree, releaseWorktree } from "./worktree.ts";

useTempAopHome();

const repoFor = () => ({ id: `repo_${crypto.randomUUID().slice(0, 8)}`, path: createRepo() });
const THREAD = "isess_abc123";

describe("choosing a thread's branch", () => {
  test("names it from the title and the end of the id", async () => {
    const repo = repoFor();

    const branch = await chooseBranchName(defaultRunGit, repo.path, THREAD, "Fix the cold start!");

    expect(branch).toBe("aop/fix-the-cold-start-abc123");
  });

  test("a branch that already exists is never taken: the name gets a counter", async () => {
    const repo = repoFor();
    git(repo.path, "branch", "aop/fix-abc123");
    git(repo.path, "branch", "aop/fix-abc123-2");

    const branch = await chooseBranchName(defaultRunGit, repo.path, THREAD, "Fix");

    expect(branch).toBe("aop/fix-abc123-3");
  });
});

describe("ensuring a worktree", () => {
  test("creates the thread's worktree on a new branch cut from the default branch", async () => {
    const repo = repoFor();
    const branch = "aop/work-abc123";

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, branch);

    const path = aopPaths.worktree(repo.id, THREAD);
    expect(ensured).toEqual({ ok: true, path });
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(git(path, "rev-parse", "HEAD")).toBe(git(repo.path, "rev-parse", "main"));
    expect(git(repo.path, "worktree", "list", "--porcelain")).toContain(
      `branch refs/heads/${branch}`,
    );
  });

  test("branches from the origin's default branch when it is not called main", async () => {
    const repo = repoFor();
    git(repo.path, "branch", "-m", "trunk");
    attachBareOrigin(repo.path, "trunk");

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");

    expect(ensured.ok).toBe(true);
    expect(git(aopPaths.worktree(repo.id, THREAD), "rev-parse", "HEAD")).toBe(
      git(repo.path, "rev-parse", "trunk"),
    );
  });

  test("running it again leaves the worktree, and what is in it, alone", async () => {
    const repo = repoFor();
    await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");
    const path = aopPaths.worktree(repo.id, THREAD);
    writeWorkFile(path, "notes.md", "half done\n");

    const again = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");

    expect(again).toEqual({ ok: true, path });
    expect(readFileSync(join(path, "notes.md"), "utf8")).toBe("half done\n");
  });

  test("a directory git never finished is replaced", async () => {
    const repo = repoFor();
    const path = aopPaths.worktree(repo.id, THREAD);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "debris"), "left by a crash");

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");

    expect(ensured).toEqual({ ok: true, path });
    expect(existsSync(join(path, "debris"))).toBe(false);
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("aop/work-abc123");
  });

  test("a directory that was a worktree but git cannot use is left as it is, with what it holds", async () => {
    const repo = repoFor();
    const path = aopPaths.worktree(repo.id, THREAD);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, ".git"), "gitdir: /nowhere/at/all\n");
    writeFileSync(join(path, "unsaved.md"), "someone's work");

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");

    expect(ensured).toMatchObject({ ok: false, message: expect.stringContaining("left as it is") });
    expect(readFileSync(join(path, "unsaved.md"), "utf8")).toBe("someone's work");
  });

  test("a worktree deleted by hand comes back on the branch it had, with its commits", async () => {
    const repo = repoFor();
    const branch = "aop/work-abc123";
    await ensureWorktree(defaultRunGit, repo, THREAD, branch);
    const path = aopPaths.worktree(repo.id, THREAD);
    writeWorkFile(path, "kept.md", "committed work\n");
    git(path, "add", "-A");
    git(path, "commit", "-m", "work");
    rmSync(path, { recursive: true, force: true });

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, branch);

    expect(ensured).toEqual({ ok: true, path });
    expect(readFileSync(join(path, "kept.md"), "utf8")).toBe("committed work\n");
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  });

  test("an origin whose default branch is not in the repo is refused with a reason", async () => {
    const repo = repoFor();
    attachBareOrigin(repo.path);
    git(repo.path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/work-abc123");

    expect(ensured).toEqual({
      ok: false,
      message: "The default branch develop does not exist in the repo",
    });
    expect(existsSync(aopPaths.worktree(repo.id, THREAD))).toBe(false);
  });

  test("a path that is not a git repository is refused", async () => {
    const path = join(aopPaths.home(), "not-a-repo");
    mkdirSync(path, { recursive: true });

    const ensured = await ensureWorktree(defaultRunGit, { id: "repo_none", path }, THREAD, "aop/x");

    expect(ensured).toMatchObject({
      ok: false,
      message: expect.stringContaining("Not a git repository"),
    });
  });
});

describe("releasing a worktree", () => {
  const withWorktree = async (branch = "aop/work-abc123") => {
    const repo = repoFor();
    await ensureWorktree(defaultRunGit, repo, THREAD, branch);
    return { repo, branch, path: aopPaths.worktree(repo.id, THREAD) };
  };

  test("discarding removes the worktree and deletes the branch, whatever the worktree held", async () => {
    const { repo, branch, path } = await withWorktree();
    writeWorkFile(path, "unsaved.md", "never committed\n");

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, { title: "Work" });

    expect(released).toEqual({ ok: true });
    expect(existsSync(path)).toBe(false);
    expect(gitSucceeds(repo.path, "rev-parse", "--verify", `refs/heads/${branch}`)).toBe(false);
    expect(git(repo.path, "worktree", "list", "--porcelain")).not.toContain(THREAD);
  });

  test("parking commits the worktree's changes to the branch, removes the worktree and keeps the branch", async () => {
    const { repo, branch, path } = await withWorktree();
    writeWorkFile(path, "unsaved.md", "kept anyway\n");

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, {
      keepBranch: true,
      title: "Fix the cold start",
    });

    expect(released).toEqual({ ok: true });
    expect(existsSync(path)).toBe(false);
    expect(git(repo.path, "show", `${branch}:unsaved.md`)).toBe("kept anyway");
    expect(git(repo.path, "log", "-1", "--format=%s", branch)).toBe(
      "chore(session): Fix the cold start",
    );
  });

  test("running a release again after it finished is not a failure and changes nothing", async () => {
    const { repo, branch } = await withWorktree();
    const options = { title: "Work" };
    await releaseWorktree(defaultRunGit, repo, THREAD, branch, options);

    const again = await releaseWorktree(defaultRunGit, repo, THREAD, branch, options);

    expect(again).toEqual({ ok: true });
    expect(git(repo.path, "branch", "--list", "aop/*")).toBe("");
  });

  test("a release that stopped after the worktree finishes by deleting the branch", async () => {
    const { repo, branch, path } = await withWorktree();
    git(repo.path, "worktree", "remove", "--force", path);

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, { title: "Work" });

    expect(released).toEqual({ ok: true });
    expect(gitSucceeds(repo.path, "rev-parse", "--verify", `refs/heads/${branch}`)).toBe(false);
  });

  test("a worktree whose directory was deleted by hand is forgotten too", async () => {
    const { repo, branch, path } = await withWorktree();
    rmSync(path, { recursive: true, force: true });

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, { title: "Work" });

    expect(released).toEqual({ ok: true });
    expect(git(repo.path, "worktree", "list", "--porcelain")).not.toContain(THREAD);
    expect(gitSucceeds(repo.path, "rev-parse", "--verify", `refs/heads/${branch}`)).toBe(false);
  });

  test("deleting the branch of a merged pull request also deletes it on origin", async () => {
    const { repo, branch, path } = await withWorktree();
    const origin = attachBareOrigin(repo.path);
    writeWorkFile(path, "shipped.md", "done\n");
    git(path, "add", "-A");
    git(path, "commit", "-m", "work");
    git(path, "push", "-u", "origin", branch);
    expect(git(origin, "branch", "--list", branch)).toContain(branch);

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, {
      title: "Work",
      deleteRemote: true,
    });

    expect(released).toEqual({ ok: true });
    expect(git(origin, "branch", "--list", branch)).toBe("");
  });

  test("a branch origin never had does not fail the release", async () => {
    const { repo, branch } = await withWorktree();
    attachBareOrigin(repo.path);

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, {
      title: "Work",
      deleteRemote: true,
    });

    expect(released).toEqual({ ok: true });
  });

  test("a repository that is gone leaves only its worktree directory to remove", async () => {
    const { repo, branch, path } = await withWorktree();
    rmSync(repo.path, { recursive: true, force: true });

    const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, { title: "Work" });

    expect(released).toEqual({ ok: true });
    expect(existsSync(path)).toBe(false);
  });

  test("changes that cannot be committed keep the worktree and say why", async () => {
    const { repo, branch, path } = await withWorktree();
    writeWorkFile(path, "unsaved.md", "pending\n");
    git(path, "config", "user.useConfigOnly", "true");
    git(repo.path, "config", "--unset", "user.email");
    git(repo.path, "config", "--unset", "user.name");
    const home = process.env.HOME;
    process.env.HOME = join(aopPaths.home(), "no-git-identity");
    try {
      const released = await releaseWorktree(defaultRunGit, repo, THREAD, branch, {
        keepBranch: true,
        title: "Work",
      });

      expect(released.ok).toBe(false);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(join(path, "unsaved.md"), "utf8")).toBe("pending\n");
    } finally {
      process.env.HOME = home;
    }
  });
});
