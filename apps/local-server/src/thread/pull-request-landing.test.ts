import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useTempAopHome } from "../project/test-utils.ts";
import { defaultRunGit, type RunGit } from "../session-git/service.ts";
import { git, gitSucceeds, writeWorkFile } from "./git-test-utils.ts";
import {
  type PrWorld,
  reloadThread,
  setupPrWorld,
  spawnWithWork,
  statusesInLog,
  worktreeOf,
} from "./pr-test-utils.ts";

const home = useTempAopHome();
let world: PrWorld | undefined;

afterEach(async () => {
  await world?.s.cleanup();
  world = undefined;
});

const setup = async (options: Parameters<typeof setupPrWorld>[1] = {}) => {
  world = await setupPrWorld(home.path(), options);
  return world;
};

const openedThread = async (w: PrWorld) => {
  const thread = await spawnWithWork(w);
  const opened = await w.s.services.threads.openPullRequest(thread.id, {});
  if (!opened.success) throw new Error(`not opened: ${JSON.stringify(opened.error)}`);
  return { thread, opened };
};

describe("merging a thread's pull request", () => {
  test("merges it, resolves the thread and removes its worktree and branch, locally and on origin", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);

    const merged = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(merged).toMatchObject({
      success: true,
      thread: {
        status: "resolved",
        artifacts: [{ type: "pr", number: 1, state: "merged" }],
      },
    });
    expect(w.github.prs[0]?.state).toBe("MERGED");
    expect(w.github.calls.find((call) => call[1] === "merge")).toContain("--squash");
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
    expect(gitSucceeds(w.repo.path, "rev-parse", "--verify", `refs/heads/${thread.branch}`)).toBe(
      false,
    );
    expect(git(w.repo.origin, "branch", "--list", thread.branch as string)).toBe("");
    expect(await statusesInLog(w.s, thread.id)).toEqual([
      "working",
      "idle",
      "ready-for-review",
      "landing",
      "resolved",
    ]);
  });

  test("merging again changes nothing and merges nothing", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    await w.s.services.threads.mergePullRequest(thread.id, {});

    const again = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(again).toMatchObject({ success: true, thread: { status: "resolved" } });
    expect(w.github.calls.filter((call) => call[1] === "merge")).toHaveLength(1);
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
  });

  test("a method other than squash is passed to GitHub", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);

    await w.s.services.threads.mergePullRequest(thread.id, { method: "rebase" });

    expect(w.github.calls.find((call) => call[1] === "merge")).toContain("--rebase");
  });

  test("a merge GitHub refuses puts the thread back where it was, with its worktree, and can be tried again", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    w.github.failMerge('Required status check "ci" has not passed');

    const refused = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(refused).toMatchObject({
      success: false,
      error: { code: "PULL_REQUEST_FAILED", reason: "CHECKS_FAILING" },
    });
    const after = await reloadThread(w.s, thread.id);
    expect(after.status).toBe("ready-for-review");
    expect(after.artifacts).toMatchObject([{ state: "open" }]);
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
    expect(await statusesInLog(w.s, thread.id)).toContain("landing");

    w.github.failMerge(null);
    const retried = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(retried).toMatchObject({ success: true, thread: { status: "resolved" } });
  });

  test("a pull request merged on GitHub is finished, not merged again", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    w.github.mergeOnGithub(1);

    const merged = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(merged).toMatchObject({ success: true, thread: { status: "resolved" } });
    expect(w.github.calls.filter((call) => call[1] === "merge")).toEqual([]);
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
  });

  test("a pull request closed without merging is not merged", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    (w.github.prs[0] as { state: string }).state = "CLOSED";

    const refused = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(refused).toEqual({ success: false, error: { code: "PULL_REQUEST_CLOSED" } });
  });

  test("a thread without a pull request has nothing to merge", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const refused = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(refused).toEqual({ success: false, error: { code: "NO_PULL_REQUEST" } });
  });

  test("cleanup that fails after the merge is reported, and running the merge again finishes it", async () => {
    let failBranchDelete = true;
    const flaky: RunGit = (args, cwd, options) =>
      failBranchDelete && args[0] === "branch" && args[1] === "-D"
        ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "cannot lock ref" })
        : defaultRunGit(args, cwd, options);
    const w = await setup({ git: { runGit: flaky } });
    const { thread } = await openedThread(w);

    const first = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(first).toMatchObject({ success: false, error: { code: "WORKTREE_FAILED" } });
    // The record says resolved only once the checkout is gone, so this thread is still landing.
    expect(await reloadThread(w.s, thread.id)).toMatchObject({
      status: "landing",
      artifacts: [{ state: "open" }],
    });
    expect(gitSucceeds(w.repo.path, "rev-parse", "--verify", `refs/heads/${thread.branch}`)).toBe(
      true,
    );

    failBranchDelete = false;
    const second = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(second).toMatchObject({
      success: true,
      thread: { status: "resolved", artifacts: [{ state: "merged" }] },
    });
    expect(gitSucceeds(w.repo.path, "rev-parse", "--verify", `refs/heads/${thread.branch}`)).toBe(
      false,
    );
    expect(w.github.calls.filter((call) => call[1] === "merge")).toHaveLength(1);
  });
});

describe("keeping a thread in step with GitHub", () => {
  test("a pull request merged on GitHub resolves the thread and cleans up", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    w.github.mergeOnGithub(1);

    const synced = await w.s.services.threads.syncPullRequest(thread.id);

    expect(synced).toMatchObject({
      success: true,
      thread: { status: "resolved", artifacts: [{ state: "merged" }] },
    });
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
  });

  test("a closed pull request is recorded as closed and the thread keeps its work", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    (w.github.prs[0] as { state: string }).state = "CLOSED";

    const synced = await w.s.services.threads.syncPullRequest(thread.id);

    expect(synced).toMatchObject({ success: true, thread: { artifacts: [{ state: "closed" }] } });
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
  });

  test("nothing new on GitHub writes nothing", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    const entries = (await w.s.db.selectFrom("event_log").select("id").execute()).length;

    await w.s.services.threads.syncPullRequest(thread.id);

    expect((await w.s.db.selectFrom("event_log").select("id").execute()).length).toBe(entries);
  });

  test("a thread left landing by a restart goes back to review, or finishes if the merge did happen", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "landing" } });

    const stalled = await w.s.services.threads.syncPullRequest(thread.id);
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "landing" } });
    w.github.mergeOnGithub(1);
    const merged = await w.s.services.threads.syncPullRequest(thread.id);

    expect(stalled).toMatchObject({ success: true, thread: { status: "ready-for-review" } });
    expect(merged).toMatchObject({ success: true, thread: { status: "resolved" } });
  });

  test("a GitHub that is not there is reported and the thread is left alone", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.ctx.threadRepository.update(thread.id, {
      pullRequest: { number: 1, url: "https://github.com/acme/widget/pull/1", state: "open" },
      status: { status: "ready-for-review" },
    });
    w.github.setUnavailable(true);

    const synced = await w.s.services.threads.syncPullRequest(thread.id);

    expect(synced).toMatchObject({
      success: false,
      error: { code: "PULL_REQUEST_FAILED", reason: "GH_UNAVAILABLE" },
    });
    expect((await reloadThread(w.s, thread.id)).status).toBe("ready-for-review");
  });
});

describe("work the merged pull request does not have", () => {
  test("a merge waits while the thread holds changes or commits the pull request lacks, and goes through once they are pushed", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    const path = worktreeOf(w, thread);
    writeWorkFile(path, "committed.md", "a commit that was never pushed\n");
    git(path, "add", "-A");
    git(path, "commit", "-m", "follow-up");
    writeWorkFile(path, "edited.md", "an edit that was never committed\n");

    const refused = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(refused).toEqual({ success: false, error: { code: "UNPUBLISHED_WORK" } });
    expect(w.github.calls.filter((call) => call[1] === "merge")).toEqual([]);
    expect((await reloadThread(w.s, thread.id)).status).toBe("ready-for-review");
    expect(existsSync(path)).toBe(true);

    await w.s.services.threads.openPullRequest(thread.id, {});
    const merged = await w.s.services.threads.mergePullRequest(thread.id, {});

    expect(merged).toMatchObject({ success: true, thread: { status: "resolved" } });
  });

  test("a merge made on GitHub while the thread holds such work keeps the branch, with the work committed", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    const path = worktreeOf(w, thread);
    writeWorkFile(path, "followup.md", "review fix, never pushed\n");
    w.github.mergeOnGithub(1);

    const synced = await w.s.services.threads.syncPullRequest(thread.id);

    expect(synced).toMatchObject({ success: true, thread: { status: "resolved" } });
    expect(existsSync(path)).toBe(false);
    expect(git(w.repo.path, "show", `${thread.branch}:followup.md`)).toBe(
      "review fix, never pushed",
    );
  });

  test("a thread reopened after its merge keeps what it holds: neither merge nor sync cleans it up", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    await w.s.services.threads.mergePullRequest(thread.id, {});
    await w.s.services.threads.send(thread.id, 'again [fake: write="again.md=new work"]');
    await w.s.settle();
    const path = worktreeOf(w, thread);

    const merge = await w.s.services.threads.mergePullRequest(thread.id, {});
    const sync = await w.s.services.threads.syncPullRequest(thread.id);
    const open = await w.s.services.threads.openPullRequest(thread.id, {});

    for (const refused of [merge, open]) {
      expect(refused).toEqual({ success: false, error: { code: "PULL_REQUEST_MERGED" } });
    }
    expect(sync).toMatchObject({ success: true, thread: { artifacts: [{ state: "merged" }] } });
    expect(readFileSync(join(path, "again.md"), "utf8")).toBe("new work");
    expect(gitSucceeds(w.repo.path, "rev-parse", "--verify", `refs/heads/${thread.branch}`)).toBe(
      true,
    );
  });

  test("a thread that is landing takes no message, so its worktree stays under the merge and not under a turn", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "landing" } });

    const sent = await w.s.services.threads.send(thread.id, "one more thing");

    expect(sent).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
  });
});

describe("a pull request belongs to one thread", () => {
  test("the database refuses a second thread of the repo holding the same pull request", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    const other = await spawnWithWork(w, "Other work");

    const clash = w.s.ctx.threadRepository.update(other.id, {
      pullRequest: { number: 1, url: "https://github.com/acme/widget/pull/1", state: "open" },
    });

    await expect(clash).rejects.toThrow(/UNIQUE constraint failed/);
    expect((await reloadThread(w.s, thread.id)).artifacts).toHaveLength(1);
    expect((await reloadThread(w.s, other.id)).artifacts).toEqual([]);
  });

  test("threads open pull requests of their own from their own branches", async () => {
    const w = await setup();
    const first = await spawnWithWork(w, "First");
    const second = await spawnWithWork(w, "Second");

    const a = await w.s.services.threads.openPullRequest(first.id, { title: "First" });
    const b = await w.s.services.threads.openPullRequest(second.id, { title: "Second" });

    expect(a).toMatchObject({ pullRequest: { number: 1 } });
    expect(b).toMatchObject({ pullRequest: { number: 2 } });
    expect(w.github.prs.map((pr) => pr.head)).toEqual([
      first.branch as string,
      second.branch as string,
    ]);
  });
});
