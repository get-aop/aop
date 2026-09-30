import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Thread } from "@aop/common";
import { aopPaths } from "@aop/infra";
import {
  createProjectStack,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import { git, gitSucceeds, writeWorkFile } from "./git-test-utils.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async (options: { repos?: number } = {}) => {
  const s = await createProjectStack(home.path(), { repos: options.repos, origin: true });
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  return { s, project: created.project, repo: s.repos[0] as { id: string; path: string } };
};

const spawnAndSettle = async (
  s: ProjectStack,
  projectId: string,
  input: Parameters<ProjectStack["services"]["threads"]["spawn"]>[1],
): Promise<Thread> => {
  const spawned = await s.services.threads.spawn(projectId, input);
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  await s.settle();
  const settled = await s.services.threads.get(spawned.thread.id);
  if (!settled.success) throw new Error("thread vanished");
  return settled.thread;
};

const worktreeOf = (repo: { id: string }, thread: Thread) => aopPaths.worktree(repo.id, thread.id);

// A thread finishing wakes its coordinator, whose turn is a run too: these are the thread's own.
const runsOf = (s: ProjectStack, thread: Thread) =>
  s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === thread.id);

const branchExists = (repoPath: string, branch: string | null) =>
  gitSucceeds(repoPath, "rev-parse", "--verify", `refs/heads/${branch}`);

const eventTypes = async (s: ProjectStack) =>
  (await s.db.selectFrom("event_log").select("type").orderBy("id").execute()).map(
    (row) => row.type,
  );

describe("a new thread's worktree", () => {
  test("gets a worktree and a branch of its own, cut from the default branch, and the repo's checkout is untouched", async () => {
    const { s, project, repo } = await setup();
    const mainBefore = git(repo.path, "rev-parse", "HEAD");

    const thread = await spawnAndSettle(s, project.id, {
      title: "Fix the cold start",
      prompt: 'Fix it [fake: write="notes.md=cold start fixed"]',
    });

    const path = worktreeOf(repo, thread);
    expect(thread.branch).toBe(`aop/fix-the-cold-start-${thread.id.slice(-6)}`);
    expect(thread.target).toEqual({ kind: "host" });
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(thread.branch as string);
    expect(git(path, "rev-parse", "HEAD")).toBe(mainBefore);
    expect(git(repo.path, "worktree", "list", "--porcelain")).toContain(
      `worktree ${realpathSync(path)}`,
    );
    // The run happened in the worktree: the file the fake wrote is there and not in the checkout.
    expect(readFileSync(join(path, "notes.md"), "utf8")).toBe("cold start fixed");
    expect(existsSync(join(repo.path, "notes.md"))).toBe(false);
    expect(git(repo.path, "status", "--porcelain")).toBe("");
    expect(git(repo.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo.path, "rev-parse", "HEAD")).toBe(mainBefore);
  });

  test("records the workspace and runs every turn in it", async () => {
    const { s, project, repo } = await setup();

    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    await s.services.threads.send(thread.id, "and more");
    await s.settle();

    const session = await s.ctx.chatSessionRepository.getById(thread.id);
    const path = realpathSync(worktreeOf(repo, thread));
    expect(session).toMatchObject({ workspace_path: path, branch: thread.branch });
    expect(JSON.parse(session?.target_json ?? "")).toEqual({ kind: "host" });
    expect(runsOf(s, thread).map((run) => run.cwd)).toEqual([path, path]);
  });

  test("two threads in one repo, even with one title, work in separate worktrees on separate branches", async () => {
    const { s, project, repo } = await setup();

    const first = await spawnAndSettle(s, project.id, { title: "Same", prompt: "one" });
    const second = await spawnAndSettle(s, project.id, { title: "Same", prompt: "two" });

    expect(first.branch).not.toBe(second.branch);
    expect(worktreeOf(repo, first)).not.toBe(worktreeOf(repo, second));
    expect(existsSync(worktreeOf(repo, first))).toBe(true);
    expect(existsSync(worktreeOf(repo, second))).toBe(true);
  });

  test("a project without repos gives its threads a scratch directory and no branch", async () => {
    const { s, project } = await setup({ repos: 0 });

    const thread = await spawnAndSettle(s, project.id, { title: "Sketch", prompt: "Sketch" });

    expect(thread.branch).toBeNull();
    expect(thread.repoId).toBeNull();
  });

  test("a repo that cannot be branched from refuses the spawn and leaves nothing behind", async () => {
    const { s, project, repo } = await setup();
    git(repo.path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");

    const spawned = await s.services.threads.spawn(project.id, { title: "Nope", prompt: "work" });

    expect(spawned).toMatchObject({ success: false, error: { code: "WORKTREE_FAILED" } });
    expect(
      await s.db.selectFrom("chat_sessions").select("id").where("kind", "=", "thread").execute(),
    ).toEqual([]);
    expect(git(repo.path, "branch", "--list", "aop/*")).toBe("");
    expect(git(repo.path, "worktree", "list", "--porcelain")).not.toContain("isess_");
    expect(s.runs).toEqual([]);
    expect(await eventTypes(s)).toEqual(
      expect.arrayContaining(["thread.upserted", "thread.removed"]),
    );
  });
});

describe("a thread whose worktree is missing", () => {
  test("gets it back on its branch, with its commits, before the next turn", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    const path = worktreeOf(repo, thread);
    writeWorkFile(path, "kept.md", "committed\n");
    git(path, "add", "-A");
    git(path, "commit", "-m", "work");
    rmSync(path, { recursive: true, force: true });

    const sent = await s.services.threads.send(thread.id, "carry on");
    await s.settle();

    expect(sent.success).toBe(true);
    expect(readFileSync(join(path, "kept.md"), "utf8")).toBe("committed\n");
    expect(runsOf(s, thread).at(-1)?.cwd).toBe(realpathSync(path));
  });

  test("answering a question in a thread whose worktree was lost works the same", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    await s.services.threads.askUser(thread.id, { question: "Which?", options: [] });
    rmSync(worktreeOf(repo, thread), { recursive: true, force: true });

    const replied = await s.services.threads.reply(thread.id, "the first");
    await s.settle();

    expect(replied.success).toBe(true);
    expect(existsSync(worktreeOf(repo, thread))).toBe(true);
  });
});

describe("deleting a thread", () => {
  test("removes its worktree and its branch as well as the thread", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, {
      title: "Doomed",
      prompt: 'Do it [fake: write="scratch.md=unsaved"]',
    });
    expect(existsSync(worktreeOf(repo, thread))).toBe(true);

    const removed = await s.services.threads.remove(thread.id);

    expect(removed).toEqual({ success: true });
    expect(existsSync(worktreeOf(repo, thread))).toBe(false);
    expect(branchExists(repo.path, thread.branch)).toBe(false);
    expect(git(repo.path, "worktree", "list", "--porcelain")).not.toContain(thread.id);
    expect(await s.ctx.chatSessionRepository.getById(thread.id)).toBeNull();
    expect((await eventTypes(s)).at(-1)).toBe("thread.removed");
  });

  test("still works when the worktree was deleted by hand first, and again when it is already gone", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Doomed", prompt: "Do it" });
    rmSync(worktreeOf(repo, thread), { recursive: true, force: true });

    const removed = await s.services.threads.remove(thread.id);
    const again = await s.services.threads.remove(thread.id);

    expect(removed).toEqual({ success: true });
    expect(again).toEqual({ success: false, error: { code: "THREAD_NOT_FOUND" } });
    expect(branchExists(repo.path, thread.branch)).toBe(false);
    expect(git(repo.path, "worktree", "list", "--porcelain")).not.toContain(thread.id);
  });

  test("finishes a delete an earlier call left half done: the worktree gone but the thread still there", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Doomed", prompt: "Do it" });
    git(repo.path, "worktree", "remove", "--force", worktreeOf(repo, thread));

    const removed = await s.services.threads.remove(thread.id);

    expect(removed).toEqual({ success: true });
    expect(branchExists(repo.path, thread.branch)).toBe(false);
    expect(await s.ctx.chatSessionRepository.getById(thread.id)).toBeNull();
  });
});

describe("a project's threads when the project is archived or deleted", () => {
  test("archiving keeps each thread's branch, with what its worktree held committed, and removes the worktree", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, {
      title: "Work",
      prompt: 'Do it [fake: write="draft.md=work in progress"]',
    });

    const archived = await s.services.projects.transition(project.id, "archive");

    expect(archived.success && archived.project.status).toBe("archived");
    expect(existsSync(worktreeOf(repo, thread))).toBe(false);
    expect(git(repo.path, "show", `${thread.branch}:draft.md`)).toBe("work in progress");
  });

  test("archiving again, or restoring and steering the thread, gets to the same place", async () => {
    const { s, project, repo } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    await s.services.projects.transition(project.id, "archive");

    const again = await s.services.projects.transition(project.id, "archive");
    await s.services.projects.transition(project.id, "restore");
    const sent = await s.services.threads.send(thread.id, "more");
    await s.settle();

    expect(again.success).toBe(true);
    expect(sent.success).toBe(true);
    expect(existsSync(worktreeOf(repo, thread))).toBe(true);
    expect(git(worktreeOf(repo, thread), "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      thread.branch as string,
    );
  });

  test("deleting removes every thread's worktree and branch, and leaves the repo alone", async () => {
    const { s, project, repo } = await setup();
    const first = await spawnAndSettle(s, project.id, { title: "One", prompt: "one" });
    const second = await spawnAndSettle(s, project.id, { title: "Two", prompt: "two" });

    const removed = await s.services.projects.remove(project.id);

    expect(removed).toEqual({ success: true });
    for (const thread of [first, second]) {
      expect(existsSync(worktreeOf(repo, thread))).toBe(false);
      expect(branchExists(repo.path, thread.branch)).toBe(false);
    }
    expect(git(repo.path, "branch", "--list")).toContain("main");
    expect(existsSync(repo.path)).toBe(true);
  });
});
