import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createProjectStack, projectSettings, useTempAopHome } from "../project/test-utils.ts";
import { commitOnOrigin, git, writeWorkFile } from "./git-test-utils.ts";
import {
  type PrWorld,
  reloadThread,
  setupPrWorld,
  spawnWithWork,
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

describe("opening a thread's pull request", () => {
  test("commits the thread's work, pushes its branch and opens the pull request, then records it", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    const url = "https://github.com/acme/widget/pull/1";
    expect(opened).toMatchObject({
      success: true,
      created: true,
      pullRequest: { number: 1, url, state: "open" },
    });
    // The work went out on the thread's own branch, committed with the thread's title.
    expect(git(w.repo.origin, "log", "-1", "--format=%s", thread.branch as string)).toBe(
      "chore(session): Fix the cold start",
    );
    expect(git(w.repo.origin, "show", `${thread.branch}:notes.md`)).toBe("cold start fixed");
    expect(w.github.prs).toMatchObject([
      {
        head: thread.branch,
        base: "main",
        title: "Fix the cold start",
        body: "Removes the eager initialisation.",
        draft: false,
      },
    ]);
    // The pull request is on the thread, in its row, and the thread waits for review.
    const after = await reloadThread(w.s, thread.id);
    expect(after.artifacts).toEqual([{ type: "pr", number: 1, url, state: "open" }]);
    expect(after.status).toBe("ready-for-review");
    expect(
      await w.s.db
        .selectFrom("chat_sessions")
        .select(["pr_number", "pr_url", "pr_state"])
        .where("id", "=", thread.id)
        .executeTakeFirst(),
    ).toEqual({ pr_number: 1, pr_url: url, pr_state: "open" });
  });

  test("tells the project stream: the entry carries the whole thread with its pull request", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const before = (await w.s.db.selectFrom("event_log").select("id").execute()).length;

    await w.s.services.threads.openPullRequest(thread.id, {});

    const entries = await w.s.db
      .selectFrom("event_log")
      .select(["type", "payload"])
      .orderBy("id")
      .execute();
    const added = entries.slice(before);
    expect(added.map((entry) => entry.type)).toEqual(["thread.upserted"]);
    expect(JSON.parse(added[0]?.payload ?? "")).toMatchObject({
      thread: {
        id: thread.id,
        status: "ready-for-review",
        artifacts: [{ type: "pr", number: 1, state: "open" }],
      },
    });
  });

  test("a thread has one pull request: asking again returns it and opens nothing", async () => {
    const w = await setup();
    const { thread, opened } = await openedThread(w);
    const entries = (await w.s.db.selectFrom("event_log").select("id").execute()).length;

    const again = await w.s.services.threads.openPullRequest(thread.id, { title: "Another" });

    expect(again).toMatchObject({ success: true, created: false, pullRequest: opened.pullRequest });
    expect(w.github.created()).toBe(1);
    expect((await w.s.db.selectFrom("event_log").select("id").execute()).length).toBe(entries);
  });

  test("two calls at once open one pull request", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    w.github.delayCreate(150);

    const results = await Promise.all([
      w.s.services.threads.openPullRequest(thread.id, {}),
      w.s.services.threads.openPullRequest(thread.id, {}),
    ]);

    // Both calls succeed and get the same pull request: one made it, the other waited for it.
    expect(results.map((result) => result.success)).toEqual([true, true]);
    expect(results.map((result) => result.success && result.created)).toEqual([true, false]);
    expect(results.map((result) => result.success && result.pullRequest.number)).toEqual([1, 1]);
    expect(w.github.created()).toBe(1);
  });

  test("picks up the pull request an interrupted call made on GitHub before it could record it", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    // The earlier call got as far as pushing and opening the pull request, then died.
    const path = worktreeOf(w, thread);
    git(path, "add", "-A");
    git(path, "commit", "-m", "work");
    git(path, "push", "-u", "origin", thread.branch as string);
    await w.github.run(
      [
        "pr",
        "create",
        "--title",
        "t",
        "--body",
        "b",
        "--base",
        "main",
        "--head",
        thread.branch as string,
      ],
      path,
    );

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(opened).toMatchObject({ success: true, created: false, pullRequest: { number: 1 } });
    expect(w.github.created()).toBe(1);
    expect((await reloadThread(w.s, thread.id)).artifacts).toHaveLength(1);
  });

  test("the thread's own title, description and draft flag are used as given", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    await w.s.services.threads.openPullRequest(thread.id, {
      title: "Lazy-load the ledger",
      body: "Loads it on first use.",
      draft: true,
    });

    expect(w.github.prs[0]).toMatchObject({
      title: "Lazy-load the ledger",
      body: "Loads it on first use.",
      draft: true,
    });
  });

  test("without a title the runtime writes one, and the thread's title stands in when it cannot", async () => {
    const w = await setup({ git: { generateDraft: undefined } });
    const thread = await spawnWithWork(w);
    // Only the fake CLI can run here (the stack refuses anything else), and it answers in prose, not JSON.
    const runsBefore = w.s.runs.length;

    await w.s.services.threads.openPullRequest(thread.id, {});

    expect(w.s.runs.length).toBe(runsBefore + 1);
    expect(w.s.runs.at(-1)).toMatchObject({ mode: "plan", isolation: "hermetic" });
    expect(w.github.prs[0]?.title).toBe("Fix the cold start");
  });

  test("the runtime writing it is told the thread's files, not what merged since the checkout pulled", async () => {
    const w = await setup({ git: { generateDraft: undefined } });
    commitOnOrigin(w.repo.origin, "MERGED.md", "from another thread\n");
    const thread = await spawnWithWork(w);

    await w.s.services.threads.openPullRequest(thread.id, {});

    const prompt = w.s.runs.at(-1)?.prompt ?? "";
    expect(prompt).toContain("Changed files:\nnotes.md\n");
    expect(prompt).not.toContain("MERGED.md");
  });

  test("a thread with nothing to publish is refused before anything is pushed", async () => {
    const w = await setup();
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Idle",
      prompt: "look around",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    const opened = await w.s.services.threads.openPullRequest(spawned.thread.id, {});

    expect(opened).toEqual({ success: false, error: { code: "NOTHING_TO_PUBLISH" } });
    expect(w.github.created()).toBe(0);
    expect(git(w.repo.origin, "branch", "--list")).not.toContain("aop/");
  });

  test("what merged on origin since the checkout last pulled is not the thread's to publish", async () => {
    const w = await setup();
    commitOnOrigin(w.repo.origin, "NOTES.md", "merged from another thread\n");
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Idle",
      prompt: "look around",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    const opened = await w.s.services.threads.openPullRequest(spawned.thread.id, {});

    expect(opened).toEqual({ success: false, error: { code: "NOTHING_TO_PUBLISH" } });
    expect(w.github.created()).toBe(0);
  });

  test("a thread with no repository has no branch to publish", async () => {
    const stack = await createProjectStack(home.path(), { repos: 0 });
    const created = await stack.services.projects.create(projectSettings({}));
    if (!created.success) throw new Error("project not created");
    const spawned = await stack.services.threads.spawn(created.project.id, {
      title: "Sketch",
      prompt: "sketch",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await stack.settle();

    const opened = await stack.services.threads.openPullRequest(spawned.thread.id, {});

    expect(opened).toEqual({ success: false, error: { code: "NO_REPOSITORY" } });
    await stack.cleanup();
  });

  test("a GitHub that is not there fails the call and changes nothing; the next call works", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    w.github.setUnavailable(true);

    const failed = await w.s.services.threads.openPullRequest(thread.id, {});
    w.github.setUnavailable(false);

    expect(failed).toMatchObject({
      success: false,
      error: { code: "PULL_REQUEST_FAILED", reason: "GH_UNAVAILABLE" },
    });
    expect((await reloadThread(w.s, thread.id)).artifacts).toEqual([]);
    expect(w.github.created()).toBe(0);
  });

  test("a push that is refused leaves the thread without a pull request", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    git(w.repo.path, "remote", "set-url", "origin", "/nonexistent/origin.git");

    const failed = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(failed).toMatchObject({
      success: false,
      error: { code: "PULL_REQUEST_FAILED", reason: "PUSH_FAILED" },
    });
    expect(w.github.created()).toBe(0);
    expect((await reloadThread(w.s, thread.id)).artifacts).toEqual([]);
  });

  test("a thread opens its own pull request from inside its turn, through its aop_open_pr tool", async () => {
    const w = await setup({ mcp: true });
    const call = {
      name: "aop_open_pr",
      arguments: { title: "Cold start", body: "By the thread." },
    };

    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Own pull request",
      prompt: `Do it [fake: write="notes.md=done" calls='${JSON.stringify([call])}']`,
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    expect(w.github.prs).toMatchObject([{ title: "Cold start", body: "By the thread." }]);
    const after = await reloadThread(w.s, spawned.thread.id);
    expect(after.artifacts).toMatchObject([{ type: "pr", number: 1, state: "open" }]);
    expect(after.status).toBe("ready-for-review");
    expect(git(w.repo.origin, "show", `${after.branch}:notes.md`)).toBe("done");
  });

  test("a project that is paused opens nothing", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.projects.transition(w.project.id, "pause");

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(opened).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });
    expect(w.github.created()).toBe(0);
  });

  test("asking again sends what the thread did since, so the pull request carries it", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    const path = worktreeOf(w, thread);
    writeWorkFile(path, "followup.md", "review fix\n");

    const again = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(again).toMatchObject({ success: true, created: false, pullRequest: { number: 1 } });
    expect(git(w.repo.origin, "show", `${thread.branch}:followup.md`)).toBe("review fix");
    expect(git(path, "status", "--porcelain")).toBe("");
    expect(w.github.created()).toBe(1);
  });

  test("a pull request that closed is not opened again: further work is a new thread", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    (w.github.prs[0] as { state: string }).state = "CLOSED";
    await w.s.services.threads.syncPullRequest(thread.id);

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(opened).toEqual({ success: false, error: { code: "PULL_REQUEST_CLOSED" } });
    expect(w.github.created()).toBe(1);
  });

  test("a pull request that merged is not opened again either", async () => {
    const w = await setup();
    const { thread } = await openedThread(w);
    await w.s.services.threads.mergePullRequest(thread.id, {});

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(opened).toEqual({ success: false, error: { code: "PULL_REQUEST_MERGED" } });
    expect(w.github.created()).toBe(1);
  });

  test("a worktree that was parked is brought back to open the pull request from it", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.resolve(thread.id);
    expect(existsSync(worktreeOf(w, thread))).toBe(false);

    const opened = await w.s.services.threads.openPullRequest(thread.id, {});

    expect(opened).toMatchObject({ success: true, created: true });
    expect(git(w.repo.origin, "show", `${thread.branch}:notes.md`)).toBe("cold start fixed");
  });
});
