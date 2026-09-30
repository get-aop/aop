import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSnapshot } from "../pull-request-watch/snapshot.ts";
import { attachBareOrigin, createRepo, git } from "../thread/git-test-utils.ts";
import { listPullRequestReviews, listReviewComments } from "./pull-request-watch.ts";
import type { CommandResult, RunGh } from "./run-gh.ts";
import { readFailedRunLog } from "./run-logs.ts";

/**
 * The fake `gh` that verification runs put on the server's PATH (.claude/skills/verify), read by
 * the code the watcher runs in production. It keeps the fake honest: if a `gh fake` control or a
 * read stops producing what `readSnapshot` understands, the Chrome recipe would silently rot.
 */
const FAKE_GH = join(import.meta.dir, "../../../../.claude/skills/verify/scripts/fake-gh.ts");

describe("the verification fake gh", () => {
  let stateDir: string;
  let scratch: string;
  let repo: string;
  let origin: string;
  let branch: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "fake-gh-state-"));
    scratch = mkdtempSync(join(tmpdir(), "fake-gh-scratch-"));
    repo = createRepo();
    origin = attachBareOrigin(repo);
    branch = "aop/cold-start-abc123";
    git(repo, "switch", "-c", branch);
    push("first.txt");
  });

  afterEach(() => {
    for (const path of [stateDir, scratch, repo, origin])
      rmSync(path, { recursive: true, force: true });
  });

  const push = (file: string) => {
    writeFileSync(join(repo, file), file);
    git(repo, "add", file);
    git(repo, "commit", "-m", file);
    git(repo, "push", "-u", "origin", branch);
  };

  const run: RunGh = async (args, cwd): Promise<CommandResult> => {
    const done = Bun.spawnSync(["bun", FAKE_GH, ...args], {
      cwd,
      env: { ...process.env, FAKE_GH_DIR: stateDir },
    });
    return {
      exitCode: done.exitCode,
      stdout: done.stdout.toString(),
      stderr: done.stderr.toString(),
    };
  };

  // What a person scripts from a shell: any directory will do.
  const script = async (...args: string[]) => {
    const result = await run(["fake", ...args], scratch);
    if (result.exitCode !== 0) throw new Error(result.stderr);
  };

  const open = async () => {
    const created = await run(
      ["pr", "create", "--title", "Fix", "--body", "b", "--base", "main", "--head", branch],
      repo,
    );
    expect(created.stdout.trim()).toBe("https://github.com/acme/widget/pull/1");
  };

  const snapshot = async () => {
    const read = await readSnapshot(run, repo, 1);
    if (!read.ok) throw new Error(read.message);
    return read.value;
  };

  test("a pull request has the head commit of its branch on origin, and no checks until scripted", async () => {
    await open();

    const { head, checks, reviews } = await snapshot();

    expect(head).toEqual({
      state: "OPEN",
      mergeable: "MERGEABLE",
      headSha: git(repo, "rev-parse", "HEAD"),
      baseRefName: "main",
    });
    expect(checks).toEqual({ reported: false, checks: [] });
    expect(reviews).toEqual([]);
  });

  test("scripted checks read as gh prints them, with a run that keeps its identity however often it is read", async () => {
    await open();
    await script("checks", "1", "pending", "test,lint");
    expect((await snapshot()).checks.checks.map((check) => check.bucket)).toEqual([
      "pending",
      "pending",
    ]);

    await script("checks", "1", "fail", "test,lint", "FAIL cold-start.test.ts\nexpected 2, got 3");
    const first = (await snapshot()).checks.checks;
    const again = (await snapshot()).checks.checks;

    expect(first.map((check) => [check.name, check.bucket, check.workflow])).toEqual([
      ["test", "fail", "ci"],
      ["lint", "fail", "ci"],
    ]);
    expect(first[0]?.link).toBe("https://github.com/acme/widget/actions/runs/100/job/1000");
    expect(first[0]?.completedAt).toBeTruthy();
    expect(again).toEqual(first);
    // The log of the run the links name is what the failed steps printed.
    expect(await readFailedRunLog(run, repo, "100")).toEqual({
      ok: true,
      value: "FAIL cold-start.test.ts\nexpected 2, got 3\n",
    });
    expect((await readFailedRunLog(run, repo, "999")).ok).toBe(false);
  });

  test("a push starts a new round of checks, pending, with a new run id", async () => {
    await open();
    await script("checks", "1", "fail");

    push("second.txt");
    const round = (await snapshot()).checks.checks;

    expect(round.map((check) => check.bucket)).toEqual(["pending"]);
    expect(round[0]?.link).toContain("/actions/runs/101/");
    expect(round[0]?.completedAt).toBeNull();

    await script("checks", "1", "pass");
    expect((await snapshot()).checks.checks[0]).toMatchObject({ bucket: "pass" });
  });

  test("reviews and their line comments read with growing ids", async () => {
    await open();
    await script(
      "review",
      "1",
      "changes-requested",
      "Please rename it",
      "src/a.ts:12:Not this: that",
    );
    await script("review", "1", "commented", "Thanks");

    const { reviews } = await snapshot();
    const comments = await listReviewComments(run, repo, 1);

    expect(reviews.map((review) => [review.state, review.body, review.author])).toEqual([
      ["CHANGES_REQUESTED", "Please rename it", "reviewer"],
      ["COMMENTED", "Thanks", "reviewer"],
    ]);
    expect(reviews[0]?.id).toBeLessThan(reviews[1]?.id ?? 0);
    expect(comments).toEqual({
      ok: true,
      value: [
        {
          id: expect.any(Number),
          reviewId: reviews[0]?.id ?? null,
          path: "src/a.ts",
          line: 12,
          body: "Not this: that",
          author: "reviewer",
        },
      ],
    });
    expect((await listPullRequestReviews(run, repo, 1)).ok).toBe(true);
  });

  test("conflicts, a merge and a close read as the pull request's state", async () => {
    await open();
    await script("conflict", "1", "on");
    expect((await snapshot()).head.mergeable).toBe("CONFLICTING");
    await script("conflict", "1", "off");

    await script("merge", "1");

    expect((await snapshot()).head.state).toBe("MERGED");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("Fix (#1)");
  });

  test("a close reads as closed", async () => {
    await open();

    await script("close", "1");

    expect((await snapshot()).head.state).toBe("CLOSED");
  });
});
