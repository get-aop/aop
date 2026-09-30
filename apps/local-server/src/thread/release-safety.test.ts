import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { RunGh } from "../github-cli/index.ts";
import { eventually, useTempAopHome } from "../project/test-utils.ts";
import { git } from "./git-test-utils.ts";
import {
  type PrWorld,
  reloadThread,
  setupPrWorld,
  spawnWithWork,
  worktreeOf,
} from "./pr-test-utils.ts";

/*
 * A worktree holds a thread's work, so nothing removes one under a turn or while a merge is
 * using it, and no status decided from an earlier read overwrites a later one.
 */

// Turns here take seconds: a fake CLI with steps and delays, and a merge kept in flight.
setDefaultTimeout(30_000);

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

const runsOf = (w: PrWorld, threadId: string) =>
  w.s.db.selectFrom("chat_runs").select("status").where("session_id", "=", threadId).execute();

/** A `gh` that takes its time over `pr merge`, so a merge stays in flight while a test acts. */
const slowMerge = (inner: () => RunGh, ms = 700): RunGh => {
  return async (args, cwd, options) => {
    if (args[0] === "pr" && args[1] === "merge") await Bun.sleep(ms);
    return inner()(args, cwd, options);
  };
};

describe("a thread with a turn running", () => {
  test("is not resolved, even when its status has gone stale", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const sent = await w.s.services.threads.send(
      thread.id,
      'more [fake: write="more.md=more" delay=300 steps=4]',
    );
    expect(sent.success).toBe(true);
    await eventually(
      () => (existsSync(join(worktreeOf(w, thread), "more.md")) ? true : undefined),
      "the turn to write its file",
    );
    // Whatever the row says, the engine has a run going: that is what a release must go by.
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "idle" } });

    const refused = await w.s.services.threads.resolve(thread.id);
    await w.s.settle();

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(readFileSync(join(worktreeOf(w, thread), "more.md"), "utf8")).toBe("more");
    expect((await runsOf(w, thread.id)).every((run) => run.status === "completed")).toBe(true);
  });

  test("keeps its worktree when its pull request is found merged: the merge is recorded and the thread carries on", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});
    await w.s.services.threads.send(
      thread.id,
      'more [fake: write="more.md=more" delay=300 steps=4]',
    );
    await eventually(
      () => (existsSync(join(worktreeOf(w, thread), "more.md")) ? true : undefined),
      "the turn to write its file",
    );
    w.github.mergeOnGithub(1);

    const synced = await w.s.services.threads.syncPullRequest(thread.id);
    await w.s.settle();

    expect(synced).toMatchObject({ success: true, thread: { status: "working" } });
    expect(readFileSync(join(worktreeOf(w, thread), "more.md"), "utf8")).toBe("more");
    expect((await runsOf(w, thread.id)).every((run) => run.status === "completed")).toBe(true);
    const after = await reloadThread(w.s, thread.id);
    expect(after.artifacts).toMatchObject([{ type: "pr", state: "merged" }]);
    expect(after.status).not.toBe("resolved");
  });

  test("is not merged while it is working", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});
    await w.s.services.threads.send(thread.id, "more [fake: delay=300 steps=3]");

    const refused = await w.s.services.threads.mergePullRequest(thread.id, {});
    await w.s.settle();

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(w.github.calls.filter((call) => call[1] === "merge")).toEqual([]);
  });

  test("a resolve and a message arriving together leave the turn its worktree, whichever comes first", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const [resolved, sent] = await Promise.all([
      w.s.services.threads.resolve(thread.id),
      w.s.services.threads.send(thread.id, 'go on [fake: write="go.md=going" delay=150 steps=3]'),
    ]);
    await w.s.settle();

    expect(sent.success).toBe(true);
    expect(resolved.success || resolved.error.code === "THREAD_BUSY").toBe(true);
    expect(readFileSync(join(worktreeOf(w, thread), "go.md"), "utf8")).toBe("going");
    expect((await runsOf(w, thread.id)).every((run) => run.status === "completed")).toBe(true);
  });
});

describe("a status decided from an earlier read", () => {
  test("does not overwrite a turn that started while a merge was refused", async () => {
    let github: RunGh | undefined;
    const w = await setup({ git: { runGh: slowMerge(() => github as RunGh) } });
    github = w.github.run;
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});
    w.github.failMerge('Required status check "ci" has not passed');

    const merging = w.s.services.threads.mergePullRequest(thread.id, {});
    await eventually(
      async () => ((await reloadThread(w.s, thread.id)).status === "landing" ? true : undefined),
      "the thread to be landing",
    );
    // What the engine does when a message reaches the thread: it is working now.
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "working" } });
    const refused = await merging;

    expect(refused).toMatchObject({ success: false, error: { code: "PULL_REQUEST_FAILED" } });
    expect((await reloadThread(w.s, thread.id)).status).toBe("working");
  });

  test("does not overwrite a status set while the pull request was being opened", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const asks = async () => {
      await w.s.ctx.threadRepository.update(thread.id, {
        status: {
          status: "waiting-on-you",
          blockedQuestion: { question: "Which one?", options: [] },
        },
      });
      return { title: "Cold start", body: "Body." };
    };
    const slow = await setupSlowDraft(w, asks);

    const opened = await slow.open(thread.id);

    expect(opened.success).toBe(true);
    expect((await reloadThread(w.s, thread.id)).status).toBe("waiting-on-you");
  });
});

describe("a repository that cannot be reached", () => {
  test("does not cost the thread its work: resolving waits until it is back", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const moved = `${w.repo.path}.away`;
    renameSync(w.repo.path, moved);

    const refused = await w.s.services.threads.resolve(thread.id);
    renameSync(moved, w.repo.path);

    expect(refused).toMatchObject({ success: false, error: { code: "WORKTREE_FAILED" } });
    expect((await reloadThread(w.s, thread.id)).status).toBe("idle");
    expect(readFileSync(join(worktreeOf(w, thread), "notes.md"), "utf8")).toBe("cold start fixed");

    const resolved = await w.s.services.threads.resolve(thread.id);

    expect(resolved).toMatchObject({ success: true, thread: { status: "resolved" } });
    expect(git(w.repo.path, "show", `${thread.branch}:notes.md`)).toBe("cold start fixed");
  });
});

// A pull request whose draft is written by `beforeDraft`, which can change the thread meanwhile.
const setupSlowDraft = async (
  w: PrWorld,
  beforeDraft: () => Promise<{ title: string; body: string }>,
) => {
  const { createThreadGit } = await import("./git.ts");
  const git = createThreadGit(w.s.ctx, { runGh: w.github.run, generateDraft: beforeDraft });
  return { open: (threadId: string) => git.openPullRequest(threadId, {}) };
};
