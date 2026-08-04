import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { listSessionGitBranches, switchSessionGitBranch } from "./branches.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("session git branches", () => {
  test("lists local branches with current, default, and worktree metadata", async () => {
    const fixture = await createFixture();
    await runGit(fixture.repoPath, "branch", "feature/picker");
    const externalWorktree = join(tmpdir(), `aop-branch-picker-external-${crypto.randomUUID()}`);
    cleanupPaths.push(externalWorktree);
    await runGit(fixture.repoPath, "worktree", "add", externalWorktree, "feature/picker");

    const result = await listSessionGitBranches(fixture.ctx, fixture.sessionId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.branches).toEqual([
        {
          name: "main",
          isCurrent: true,
          isDefault: true,
          worktreePath: await realpath(fixture.repoPath),
        },
        {
          name: "feature/picker",
          isCurrent: false,
          isDefault: false,
          worktreePath: await realpath(externalWorktree),
        },
      ]);
    }
    await fixture.db.destroy();
  });

  test("creates a linked worktree when switching away from the repository root", async () => {
    const fixture = await createFixture();
    await runGit(fixture.repoPath, "branch", "feature/picker");

    const result = await switchSessionGitBranch(fixture.ctx, fixture.sessionId, "feature/picker");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.branch).toBe("feature/picker");
      expect(result.result.workspacePath).toBe(
        await realpath(aopPaths.worktree(fixture.repoId, fixture.sessionId)),
      );
      expect(await currentBranch(result.result.workspacePath)).toBe("feature/picker");
      expect(await currentBranch(fixture.repoPath)).toBe("main");
    }
    const session = await fixture.ctx.chatSessionRepository.getById(fixture.sessionId);
    expect(session?.workspace_path).toBe(
      await realpath(aopPaths.worktree(fixture.repoId, fixture.sessionId)),
    );
    await fixture.db.destroy();
  });

  test("switches branches inside the session worktree and refuses dirty workspaces", async () => {
    const fixture = await createFixture();
    await runGit(fixture.repoPath, "branch", "feature/one");
    await runGit(fixture.repoPath, "branch", "feature/two");
    const first = await switchSessionGitBranch(fixture.ctx, fixture.sessionId, "feature/one");
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await switchSessionGitBranch(fixture.ctx, fixture.sessionId, "feature/two");
    expect(second).toEqual({
      success: true,
      result: { branch: "feature/two", workspacePath: first.result.workspacePath },
    });
    expect(await currentBranch(first.result.workspacePath)).toBe("feature/two");

    await writeFile(join(first.result.workspacePath, "dirty.txt"), "pending\n");
    const dirty = await switchSessionGitBranch(fixture.ctx, fixture.sessionId, "feature/one");
    expect(dirty).toEqual({
      success: false,
      error: {
        code: "DIRTY_WORKSPACE",
        message: "Commit or discard the current changes before switching branches",
      },
    });
    await fixture.db.destroy();
  });
});

const createFixture = async () => {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const repoId = `repo_branch_${suffix}`;
  const sessionId = `csess_branch_${suffix}`;
  const repoPath = join(tmpdir(), `aop-session-branch-${suffix}`);
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, repoId, repoPath);
  cleanupPaths.push(repoPath, aopPaths.worktrees(repoId));
  const now = new Date().toISOString();
  await ctx.chatSessionRepository.create({
    id: sessionId,
    repo_id: repoId,
    title: "Branch picker",
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
  return { db, ctx, repoId, repoPath, sessionId };
};

const runGit = async (cwd: string, ...args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};

const currentBranch = async (cwd: string): Promise<string> => {
  const proc = Bun.spawn(["git", "branch", "--show-current"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
  return stdout.trim();
};
