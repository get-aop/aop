import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createSessionWorktree, suggestSessionBranchName } from "./worktree.ts";

const runGit = async (cwd: string, ...args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};

const createSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  input: { id: string; repoId: string | null; title?: string },
) => {
  const now = new Date().toISOString();
  return ctx.chatSessionRepository.create({
    id: input.id,
    repo_id: input.repoId,
    title: input.title ?? "Fix auth flow",
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
    workspace_path: null,
    created_at: now,
    updated_at: now,
  });
};

describe("suggestSessionBranchName", () => {
  test("builds aop/<slug>-<shortid> from title and session id", () => {
    expect(suggestSessionBranchName("Fix Auth Flow!", "csess_abc123def456")).toBe(
      "aop/fix-auth-flow-def456",
    );
  });
});

describe("createSessionWorktree", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("creates a real worktree and binds the session workspace", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-wt-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_wt_1", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_wt_1"));

    const session = await createSession(ctx, {
      id: "csess_worktree_create01",
      repoId: "repo_wt_1",
      title: "Session Worktree",
    });

    const result = await createSessionWorktree(ctx, session.id, {
      branchName: "aop/session-worktree-create01",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.worktree.branch).toBe("aop/session-worktree-create01");
    expect(result.worktree.path).toBe(aopPaths.worktree("repo_wt_1", session.id));
    expect(result.session.workspacePath).toBe(await realpath(result.worktree.path));

    const branchProbe = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: result.worktree.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    const branchOut = await new Response(branchProbe.stdout).text();
    expect(await branchProbe.exited).toBe(0);
    expect(branchOut.trim()).toBe("aop/session-worktree-create01");

    const reloaded = await ctx.chatSessionRepository.getById(session.id);
    expect(reloaded?.workspace_path).toBe(await realpath(result.worktree.path));

    await db.destroy();
  });

  test("returns typed error when branch already exists", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-wt-branch-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_wt_branch", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_wt_branch"));

    await runGit(repoPath, "branch", "aop/taken-branch");
    const session = await createSession(ctx, {
      id: "csess_worktree_branch01",
      repoId: "repo_wt_branch",
    });

    const result = await createSessionWorktree(ctx, session.id, {
      branchName: "aop/taken-branch",
    });
    expect(result).toEqual({
      success: false,
      error: {
        code: "BRANCH_EXISTS",
        message: "Branch already exists: aop/taken-branch",
      },
    });

    await db.destroy();
  });

  test("returns typed error for a non-git session without a repository", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const session = await createSession(ctx, {
      id: "csess_worktree_nongit01",
      repoId: null,
    });

    const result = await createSessionWorktree(ctx, session.id, {});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_A_GIT_REPO");

    await db.destroy();
  });

  test("returns not found for an unknown session", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const result = await createSessionWorktree(ctx, "csess_missing", {});
    expect(result).toEqual({
      success: false,
      error: { code: "SESSION_NOT_FOUND" },
    });

    await db.destroy();
  });

  test("defaults branch name from session title when omitted", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-wt-default-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_wt_default", repoPath);
    cleanupPaths.push(repoPath, aopPaths.worktrees("repo_wt_default"));

    const session = await createSession(ctx, {
      id: "csess_worktree_default01",
      repoId: "repo_wt_default",
      title: "Polish Diffstat",
    });

    const result = await createSessionWorktree(ctx, session.id, {});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.worktree.branch).toBe(suggestSessionBranchName(session.title, session.id));

    await db.destroy();
  });
});
