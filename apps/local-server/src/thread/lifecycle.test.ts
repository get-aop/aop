import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createProjectStack, projectSettings, useTempAopHome } from "../project/test-utils.ts";
import { git } from "./git-test-utils.ts";
import { IDLE_DAYS_BEFORE_RESOLVED, startThreadMaintenance } from "./lifecycle.ts";
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

const setup = async () => {
  world = await setupPrWorld(home.path());
  return world;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const idleFor = async (w: PrWorld, threadId: string, days: number, now: Date) => {
  const at = new Date(now.getTime() - days * DAY_MS).toISOString();
  await w.s.db
    .updateTable("chat_sessions")
    .set({ last_activity_at: at })
    .where("id", "=", threadId)
    .execute();
};

describe("resolving a thread", () => {
  test("stamps it resolved, removes its worktree and keeps its branch with the work committed", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const resolved = await w.s.services.threads.resolve(thread.id);

    expect(resolved).toMatchObject({
      success: true,
      thread: { status: "resolved", resolvedAt: expect.any(String) },
    });
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
    expect(git(w.repo.path, "show", `${thread.branch}:notes.md`)).toBe("cold start fixed");
    const types = (await w.s.db.selectFrom("event_log").select("type").orderBy("id").execute()).map(
      (row) => row.type,
    );
    expect(types.at(-1)).toBe("thread.upserted");
  });

  test("resolving again keeps the first time and changes nothing", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const first = await w.s.services.threads.resolve(thread.id);
    const entries = (await w.s.db.selectFrom("event_log").select("id").execute()).length;

    const again = await w.s.services.threads.resolve(thread.id);

    expect(again).toEqual(first);
    expect((await w.s.db.selectFrom("event_log").select("id").execute()).length).toBe(entries);
  });

  test("finishes a resolve that was interrupted after the worktree went", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.ctx.threadRepository.update(thread.id, { lastActivityAt: new Date().toISOString() });
    git(w.repo.path, "worktree", "remove", "--force", worktreeOf(w, thread));

    const resolved = await w.s.services.threads.resolve(thread.id);

    expect(resolved).toMatchObject({ success: true, thread: { status: "resolved" } });
  });

  test("a message reopens it: the worktree comes back on the branch and the thread works again", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.resolve(thread.id);

    const sent = await w.s.services.threads.send(thread.id, "one more thing");
    await w.s.settle();

    expect(sent).toMatchObject({ success: true, thread: { status: "working" } });
    expect(sent.success && sent.thread).not.toHaveProperty("resolvedAt");
    expect(git(worktreeOf(w, thread), "show", "HEAD:notes.md")).toBe("cold start fixed");
  });

  test("a thread that is working is stopped first, not resolved under its turn", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.send(thread.id, "more [fake: delay=300 steps=2]");

    const refused = await w.s.services.threads.resolve(thread.id);
    await w.s.settle();

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
  });

  test("a thread landing its pull request is not resolved under the merge", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "landing" } });

    const refused = await w.s.services.threads.resolve(thread.id);

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(existsSync(worktreeOf(w, thread))).toBe(true);
  });

  test("an unknown thread is not found", async () => {
    const w = await setup();

    expect(await w.s.services.threads.resolve("isess_nope")).toEqual({
      success: false,
      error: { code: "THREAD_NOT_FOUND" },
    });
  });

  test("a thread that has a pull request keeps it when it is resolved", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});

    const resolved = await w.s.services.threads.resolve(thread.id);

    expect(resolved).toMatchObject({
      success: true,
      thread: { status: "resolved", artifacts: [{ type: "pr", number: 1, state: "open" }] },
    });
  });
});

describe("thread maintenance", () => {
  test("resolves a thread idle for a week, and only that one", async () => {
    const w = await setup();
    const now = new Date("2026-09-30T12:00:00.000Z");
    const stale = await spawnWithWork(w, "Stale");
    const recent = await spawnWithWork(w, "Recent");
    const review = await spawnWithWork(w, "Review");
    await idleFor(w, stale.id, IDLE_DAYS_BEFORE_RESOLVED + 1, now);
    await idleFor(w, recent.id, IDLE_DAYS_BEFORE_RESOLVED - 1, now);
    await idleFor(w, review.id, 30, now);
    await w.s.ctx.threadRepository.update(review.id, { status: { status: "ready-for-review" } });

    await w.s.services.git.runMaintenance(now);

    expect((await reloadThread(w.s, stale.id)).status).toBe("resolved");
    expect((await reloadThread(w.s, recent.id)).status).toBe("idle");
    expect((await reloadThread(w.s, review.id)).status).toBe("ready-for-review");
    expect(existsSync(worktreeOf(w, stale))).toBe(false);
    expect(existsSync(worktreeOf(w, recent))).toBe(true);
  });

  test("runs again with nothing left to do", async () => {
    const w = await setup();
    const now = new Date("2026-09-30T12:00:00.000Z");
    const stale = await spawnWithWork(w, "Stale");
    await idleFor(w, stale.id, 9, now);
    await w.s.services.git.runMaintenance(now);
    const entries = (await w.s.db.selectFrom("event_log").select("id").execute()).length;

    await w.s.services.git.runMaintenance(now);

    expect((await w.s.db.selectFrom("event_log").select("id").execute()).length).toBe(entries);
  });

  test("settles a thread a restart left landing", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});
    await w.s.ctx.threadRepository.update(thread.id, { status: { status: "landing" } });
    w.github.mergeOnGithub(1);

    await w.s.services.git.runMaintenance();

    expect(await reloadThread(w.s, thread.id)).toMatchObject({
      status: "resolved",
      artifacts: [{ state: "merged" }],
    });
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
  });

  test("a pass that cannot reach GitHub leaves the landing thread as it was and does not throw", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.ctx.threadRepository.update(thread.id, {
      pullRequest: { number: 1, url: "https://github.com/acme/widget/pull/1", state: "open" },
      status: { status: "landing" },
    });
    w.github.setUnavailable(true);

    await w.s.services.git.runMaintenance();

    expect((await reloadThread(w.s, thread.id)).status).toBe("landing");
  });

  test("starts with one pass and repeats until stopped", async () => {
    let passes = 0;
    const stop = startThreadMaintenance(
      {
        runMaintenance: async () => {
          passes += 1;
        },
      },
      20,
    );
    await Bun.sleep(90);
    stop();
    const stoppedAt = passes;
    await Bun.sleep(60);

    expect(stoppedAt).toBeGreaterThanOrEqual(3);
    expect(passes).toBe(stoppedAt);
  });

  test("a pass that throws does not end the schedule", async () => {
    let passes = 0;
    const stop = startThreadMaintenance(
      {
        runMaintenance: async () => {
          passes += 1;
          throw new Error("boom");
        },
      },
      20,
    );
    await Bun.sleep(70);
    stop();

    expect(passes).toBeGreaterThanOrEqual(2);
  });
});

describe("threads with no repo", () => {
  test("resolve them without any worktree to remove", async () => {
    const s = await createProjectStack(home.path(), { repos: 0 });
    const created = await s.services.projects.create(projectSettings({}));
    if (!created.success) throw new Error("project not created");
    const spawned = await s.services.threads.spawn(created.project.id, {
      title: "Sketch",
      prompt: "sketch",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const resolved = await s.services.threads.resolve(spawned.thread.id);

    expect(resolved).toMatchObject({ success: true, thread: { status: "resolved" } });
    await s.cleanup();
  });
});
