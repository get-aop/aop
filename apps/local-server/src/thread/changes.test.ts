import { afterEach, describe, expect, test } from "bun:test";
import { createProjectStack, projectSettings, useTempAopHome } from "../project/test-utils.ts";
import { writeWorkFile } from "./git-test-utils.ts";
import { type PrWorld, setupPrWorld, spawnWithWork, worktreeOf } from "./pr-test-utils.ts";

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

describe("what a thread changed", () => {
  test("lists the file the thread wrote, untracked, and a tracked file it edited, without hunks", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    writeWorkFile(worktreeOf(w, thread), ".gitkeep", "faster\n");

    const result = await w.s.services.threads.changes(thread.id);

    expect(result).toMatchObject({ success: true, diff: { defaultBranch: "main" } });
    if (!result.success) return;
    expect(result.diff.summaryOnly).toBe(true);
    // A tracked file has its counts in the summary; an untracked one is counted when its body is read.
    expect(result.diff.files).toMatchObject([
      { path: ".gitkeep", status: "modified", additions: 1, deletions: 0, hunks: [] },
      { path: "notes.md", status: "added", additions: 0, detailsPending: true, hunks: [] },
    ]);
  });

  test("still lists the work once the thread has committed and pushed it in its pull request", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.services.threads.openPullRequest(thread.id, {});

    const result = await w.s.services.threads.changes(thread.id);

    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(result.diff.files.map((file) => file.path)).toEqual(["notes.md"]);
  });

  test("a thread that has changed nothing has no files", async () => {
    const w = await setup();
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Look",
      prompt: "look",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    const result = await w.s.services.threads.changes(spawned.thread.id);

    expect(result).toMatchObject({ success: true, diff: { files: [] } });
  });

  test("returns one file's hunks with its lines, and a file the thread did not touch is not found", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    writeWorkFile(worktreeOf(w, thread), ".gitkeep", "faster\n");

    const added = await w.s.services.threads.changedFile(thread.id, "notes.md");
    const edited = await w.s.services.threads.changedFile(thread.id, ".gitkeep");
    const untouched = await w.s.services.threads.changedFile(thread.id, "package.json");

    expect(added).toMatchObject({
      success: true,
      file: {
        path: "notes.md",
        status: "added",
        hunks: [{ lines: [{ type: "add", newNo: 1, text: "cold start fixed" }] }],
      },
    });
    expect(edited).toMatchObject({
      success: true,
      file: { path: ".gitkeep", additions: 1, deletions: 0 },
    });
    if (edited.success) {
      const lines = edited.file.hunks.flatMap((hunk) => hunk.lines);
      expect(lines.filter((line) => line.type === "add").map((line) => line.text)).toEqual([
        "faster",
      ]);
    }
    expect(untouched).toEqual({ success: false, error: { code: "FILE_NOT_FOUND" } });
  });

  test("refuses a path that is empty, absolute, or leaves the worktree, before it reads anything", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    for (const path of ["", "  ", "/etc/passwd", "../outside", "a/../../b", "a\0b"]) {
      expect(await w.s.services.threads.changedFile(thread.id, path)).toEqual({
        success: false,
        error: { code: "INVALID_PATH" },
      });
    }
  });

  test("an unknown thread is not found, and so is the coordinator, which is a session but no thread", async () => {
    const w = await setup();
    const coordinator = await w.s.ctx.chatSessionRepository.getCoordinator(w.project.id);

    const unknown = await w.s.services.threads.changes("isess_nope");
    const notAThread = await w.s.services.threads.changedFile(coordinator?.id ?? "", "notes.md");

    expect(unknown).toEqual({ success: false, error: { code: "THREAD_NOT_FOUND" } });
    expect(notAThread).toEqual({ success: false, error: { code: "THREAD_NOT_FOUND" } });
  });

  test("a resolved thread has no worktree left to compare, and none is made for it", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    const resolved = await w.s.services.threads.resolve(thread.id);
    if (!resolved.success) throw new Error("not resolved");

    const summary = await w.s.services.threads.changes(thread.id);
    const file = await w.s.services.threads.changedFile(thread.id, "notes.md");

    for (const result of [summary, file]) {
      expect(result).toMatchObject({ success: false, error: { code: "WORKTREE_FAILED" } });
    }
    expect(await Bun.file(`${worktreeOf(w, thread)}/notes.md`).exists()).toBe(false);
  });

  test("a thread with no repository has no branch to compare", async () => {
    const stack = await createProjectStack(home.path(), { repos: 0 });
    const created = await stack.services.projects.create(projectSettings({}));
    if (!created.success) throw new Error("project not created");
    const spawned = await stack.services.threads.spawn(created.project.id, {
      title: "Sketch",
      prompt: "sketch",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await stack.settle();

    const summary = await stack.services.threads.changes(spawned.thread.id);
    const file = await stack.services.threads.changedFile(spawned.thread.id, "a.md");

    expect(summary).toEqual({ success: false, error: { code: "NO_REPOSITORY" } });
    expect(file).toEqual({ success: false, error: { code: "NO_REPOSITORY" } });
    await stack.cleanup();
  });
});
