import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { CommandTimeoutError, type RunCommandOptions } from "../command-runner.ts";
import { useTempAopHome } from "../project/test-utils.ts";
import { defaultRunGit, type RunGit } from "../session-git/service.ts";
import {
  attachBareOrigin,
  commitOnOrigin,
  createRepo,
  git,
  gitSucceeds,
  writeWorkFile,
} from "./git-test-utils.ts";
import { chooseBranchName, ensureWorktree, releaseWorktree } from "./worktree.ts";

useTempAopHome();

const repoFor = () => ({ id: `repo_${crypto.randomUUID().slice(0, 8)}`, path: createRepo() });
const THREAD = "isess_abc123";

/** Real git that also keeps each `git fetch` it ran, with the options it was given. */
const recordingGit = (fetch: RunGit = defaultRunGit) => {
  const fetches: RunCommandOptions[] = [];
  const runGit: RunGit = (args, cwd, options) => {
    if (args[0] !== "fetch") return defaultRunGit(args, cwd, options);
    fetches.push(options ?? {});
    return fetch(args, cwd, options);
  };
  return { runGit, fetches };
};

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

// git lists every worktree of a repository while it adds, removes or prunes one, and a listing
// that meets another command's half-made entry dies with "failed to read .../commondir". Threads
// spawned or released together in one repository must not depend on winning that race.
describe("worktrees made and released together in one repository", () => {
  const ROUNDS = 6;
  const THREADS = 10;

  test("every one of them succeeds, however many run at once", async () => {
    const repo = repoFor();
    const failures: string[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      const threads = Array.from({ length: THREADS }, (_, index) => ({
        id: `isess_r${round}t${index}`,
        branch: `aop/work-r${round}t${index}`,
      }));
      const ensured = await Promise.all(
        threads.map(({ id, branch }) => ensureWorktree(defaultRunGit, repo, id, branch)),
      );
      const released = await Promise.all(
        threads.map(({ id, branch }) =>
          releaseWorktree(defaultRunGit, repo, id, branch, { title: "Work" }),
        ),
      );
      for (const result of [...ensured, ...released]) {
        if (!result.ok) failures.push(result.message);
      }
    }

    expect(failures).toEqual([]);
  }, 60_000);
});

describe("where a new thread's branch starts", () => {
  const withOrigin = () => {
    const repo = repoFor();
    return { repo, origin: attachBareOrigin(repo.path) };
  };
  const headOf = (repo: { id: string }, threadId = THREAD) =>
    git(aopPaths.worktree(repo.id, threadId), "rev-parse", "HEAD");

  test("at origin's default branch as it is now, which the checkout never pulled", async () => {
    const { repo, origin } = withOrigin();
    const checkoutMain = git(repo.path, "rev-parse", "main");
    const merged = commitOnOrigin(origin, "NOTES.md", "hello\n");

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/next-abc123");

    const path = aopPaths.worktree(repo.id, THREAD);
    expect(ensured).toEqual({ ok: true, path });
    expect(headOf(repo)).toBe(merged);
    expect(readFileSync(join(path, "NOTES.md"), "utf8")).toBe("hello\n");
    // Only origin's copy moved: the checkout's branch and files are as they were.
    expect(git(repo.path, "rev-parse", "refs/remotes/origin/main")).toBe(merged);
    expect(git(repo.path, "rev-parse", "main")).toBe(checkoutMain);
    expect(git(repo.path, "rev-parse", "HEAD")).toBe(checkoutMain);
    expect(existsSync(join(repo.path, "NOTES.md"))).toBe(false);
    expect(git(repo.path, "status", "--porcelain")).toBe("");
  });

  test("with no upstream, so a bare `git push` in the worktree cannot land on the default branch", async () => {
    const { repo } = withOrigin();

    await ensureWorktree(defaultRunGit, repo, THREAD, "aop/next-abc123");

    expect(gitSucceeds(repo.path, "rev-parse", "--verify", "aop/next-abc123@{upstream}")).toBe(
      false,
    );
  });

  test("without a commit the checkout's default branch has and origin does not", async () => {
    const { repo } = withOrigin();
    const published = git(repo.path, "rev-parse", "main");
    writeWorkFile(repo.path, "local.md", "never pushed\n");
    git(repo.path, "add", "local.md");
    git(repo.path, "commit", "-m", "local only");

    await ensureWorktree(defaultRunGit, repo, THREAD, "aop/next-abc123");

    expect(headOf(repo)).toBe(published);
    expect(existsSync(join(aopPaths.worktree(repo.id, THREAD), "local.md"))).toBe(false);
  });

  test("at what origin last had when origin cannot be reached", async () => {
    const { repo, origin } = withOrigin();
    const merged = commitOnOrigin(origin, "NOTES.md", "hello\n");
    git(repo.path, "fetch", "-q", "origin");
    rmSync(origin, { recursive: true, force: true });

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/next-abc123");

    expect(ensured.ok).toBe(true);
    expect(headOf(repo)).toBe(merged);
  });

  test("at the checkout's default branch when origin cannot be reached and was never fetched", async () => {
    const repo = repoFor();
    git(repo.path, "remote", "add", "origin", join(aopPaths.home(), "gone.git"));

    const ensured = await ensureWorktree(defaultRunGit, repo, THREAD, "aop/next-abc123");

    expect(ensured.ok).toBe(true);
    expect(headOf(repo)).toBe(git(repo.path, "rev-parse", "main"));
  });

  test("at what origin last had when the fetch runs out of time, which is bounded and asks nothing", async () => {
    const { repo, origin } = withOrigin();
    const known = git(repo.path, "rev-parse", "refs/remotes/origin/main");
    commitOnOrigin(origin, "NOTES.md", "hello\n");
    const recorder = recordingGit(async (_args, _cwd, options) => {
      throw new CommandTimeoutError(options?.timeoutMs ?? 0);
    });

    const ensured = await ensureWorktree(recorder.runGit, repo, THREAD, "aop/next-abc123");

    expect(ensured.ok).toBe(true);
    expect(headOf(repo)).toBe(known);
    expect(recorder.fetches).toHaveLength(1);
    expect(recorder.fetches[0]?.timeoutMs).toBeLessThanOrEqual(20_000);
    expect(recorder.fetches[0]?.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0" });
  });

  test("and a thread started later fetches again, so it starts from what merged in between", async () => {
    const { repo, origin } = withOrigin();
    await ensureWorktree(defaultRunGit, repo, THREAD, "aop/first-abc123");
    const merged = commitOnOrigin(origin, "NOTES.md", "hello\n");

    await ensureWorktree(defaultRunGit, repo, "isess_def456", "aop/second-def456");

    expect(headOf(repo, "isess_def456")).toBe(merged);
  });

  test("threads started together in one repository share one fetch and all start from it", async () => {
    const { repo, origin } = withOrigin();
    const merged = commitOnOrigin(origin, "NOTES.md", "hello\n");
    const recorder = recordingGit();
    const threads = ["isess_aaa111", "isess_bbb222", "isess_ccc333"];

    const ensured = await Promise.all(
      threads.map((id) => ensureWorktree(recorder.runGit, repo, id, `aop/work-${id.slice(-6)}`)),
    );

    expect(ensured.map((result) => result.ok)).toEqual([true, true, true]);
    expect(threads.map((id) => headOf(repo, id))).toEqual([merged, merged, merged]);
    expect(recorder.fetches).toHaveLength(1);
  });

  test("a branch that survived comes back where it was, and nothing is fetched", async () => {
    const { repo, origin } = withOrigin();
    const branch = "aop/work-abc123";
    await ensureWorktree(defaultRunGit, repo, THREAD, branch);
    const path = aopPaths.worktree(repo.id, THREAD);
    writeWorkFile(path, "kept.md", "committed work\n");
    git(path, "add", "-A");
    git(path, "commit", "-m", "work");
    const work = git(path, "rev-parse", "HEAD");
    git(repo.path, "worktree", "remove", "--force", path);
    const known = git(repo.path, "rev-parse", "refs/remotes/origin/main");
    commitOnOrigin(origin, "NOTES.md", "later\n");
    const recorder = recordingGit();

    const ensured = await ensureWorktree(recorder.runGit, repo, THREAD, branch);

    expect(ensured).toEqual({ ok: true, path });
    expect(headOf(repo)).toBe(work);
    expect(recorder.fetches).toHaveLength(0);
    expect(git(repo.path, "rev-parse", "refs/remotes/origin/main")).toBe(known);
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
