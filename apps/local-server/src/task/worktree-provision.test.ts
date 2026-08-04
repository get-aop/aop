import { afterEach, describe, expect, test } from "bun:test";
import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import {
  ensureTaskWorktreeAndBindOriginSession,
  rebindOriginSessionAfterHandoff,
} from "./worktree-provision.ts";

const createSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  input: { id: string; repoId: string; workspacePath?: string | null },
) => {
  const now = new Date().toISOString();
  return ctx.chatSessionRepository.create({
    id: input.id,
    repo_id: input.repoId,
    title: "Origin chat",
    named: true,
    runtime: "claude-code",
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    runtime_configuration_id: null,
    fast_mode: false,
    pinned: false,
    settled_override: null,
    settled_at: null,
    default_worker_id: null,
    default_workflow_id: null,
    workspace_path: input.workspacePath ?? null,
    created_at: now,
    updated_at: now,
  });
};

const readBranch = async (cwd: string): Promise<string> => {
  const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return out.trim();
};

describe("ensureTaskWorktreeAndBindOriginSession", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("creates a task worktree and binds the origin chat session", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-task-wt-${crypto.randomUUID()}`);
    await createTestRepo(db, "repo_task_wt", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_task_wt"));

    await createTestTask(db, "task_wt_1", "repo_task_wt", "docs/tasks/login-fix", "DRAFT");
    await ctx.taskRepository.update("task_wt_1", {
      origin_chat_session_id: "isess_origin_wt",
    });
    await createSession(ctx, { id: "isess_origin_wt", repoId: "repo_task_wt" });

    const result = await ensureTaskWorktreeAndBindOriginSession(ctx, "task_wt_1");
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.path).toBe(aopPaths.worktree("repo_task_wt", "task_wt_1"));
    expect(await readBranch(result.path)).toBe(result.branch);

    const task = await ctx.taskRepository.get("task_wt_1");
    expect(task?.worktree_path).toBe(result.path);
    expect(task?.branch_name).toBe(result.branch);

    const session = await ctx.chatSessionRepository.getById("isess_origin_wt");
    expect(session?.workspace_path).toBe(await realpath(result.path));

    // Shared main checkout stays on main — other sessions are not moved.
    expect(await readBranch(repoPath)).toBe("main");

    await db.destroy();
  });

  test("is idempotent when the worktree already exists", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-task-wt-idemp-${crypto.randomUUID()}`);
    await createTestRepo(db, "repo_task_wt_idemp", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_task_wt_idemp"));

    await createTestTask(db, "task_wt_2", "repo_task_wt_idemp", "docs/tasks/retry-flow", "DRAFT");
    const first = await ensureTaskWorktreeAndBindOriginSession(ctx, "task_wt_2");
    const second = await ensureTaskWorktreeAndBindOriginSession(ctx, "task_wt_2");

    expect(first?.path).toBe(second?.path);
    expect(first?.branch).toBe(second?.branch);

    await db.destroy();
  });

  test("binds an explicit session id over the stored origin", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-task-wt-bind-${crypto.randomUUID()}`);
    await createTestRepo(db, "repo_task_wt_bind", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_task_wt_bind"));

    await createTestTask(db, "task_wt_3", "repo_task_wt_bind", "docs/tasks/bind-chat", "DRAFT");
    await createSession(ctx, { id: "isess_explicit", repoId: "repo_task_wt_bind" });

    const result = await ensureTaskWorktreeAndBindOriginSession(ctx, "task_wt_3", "isess_explicit");
    expect(result).not.toBeNull();

    const session = await ctx.chatSessionRepository.getById("isess_explicit");
    expect(session?.workspace_path).toBe(await realpath(result?.path ?? ""));

    await db.destroy();
  });
});

describe("rebindOriginSessionAfterHandoff", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("moves the origin chat onto a session worktree on the task branch", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-task-wt-handoff-${crypto.randomUUID()}`);
    await createTestRepo(db, "repo_task_wt_ho", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_task_wt_ho"));

    await createTestTask(db, "task_wt_ho", "repo_task_wt_ho", "docs/tasks/handoff-bind", "DONE");
    await createSession(ctx, { id: "isess_handoff", repoId: "repo_task_wt_ho" });
    await ctx.taskRepository.update("task_wt_ho", {
      origin_chat_session_id: "isess_handoff",
      branch_name: "handoff-bind",
    });

    const provisioned = await ensureTaskWorktreeAndBindOriginSession(ctx, "task_wt_ho");
    expect(provisioned).not.toBeNull();
    if (!provisioned) return;

    // Simulate handoff removing the task worktree while keeping the branch.
    const previousRealPath = await realpath(provisioned.path);
    await Bun.$`git worktree remove --force ${provisioned.path}`.cwd(repoPath).quiet();
    await ctx.taskRepository.update("task_wt_ho", { worktree_path: null });

    await rebindOriginSessionAfterHandoff(
      ctx,
      {
        id: "task_wt_ho",
        repo_id: "repo_task_wt_ho",
        branch_name: provisioned.branch,
        change_path: "docs/tasks/handoff-bind",
        origin_chat_session_id: "isess_handoff",
      },
      previousRealPath,
    );

    const session = await ctx.chatSessionRepository.getById("isess_handoff");
    const sessionWorktree = aopPaths.worktree("repo_task_wt_ho", "isess_handoff");
    expect(session?.workspace_path).toBe(await realpath(sessionWorktree));
    expect(await readBranch(sessionWorktree)).toBe(provisioned.branch);
    expect(await readBranch(repoPath)).toBe("main");

    await db.destroy();
  });
});
