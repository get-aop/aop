import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import type { RunGh } from "../github-cli/index.ts";
import { defaultRunGit, getSessionGitStatus } from "./service.ts";

/** Tests must never call the real gh CLI; default to "gh unavailable". */
const unavailableGh: RunGh = async () => ({ exitCode: 1, stdout: "", stderr: "gh not logged in" });

const runGit = async (cwd: string, ...args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};

const createSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  input: { id: string; repoId: string | null; workspacePath?: string | null },
) => {
  const now = new Date().toISOString();
  return ctx.chatSessionRepository.create({
    id: input.id,
    repo_id: input.repoId,
    title: "Git status session",
    named: false,
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

const setupSession = async () => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repoPath = join(tmpdir(), `aop-session-git-${crypto.randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, "repo_session_git", repoPath);
  const session = await createSession(ctx, {
    id: `csess_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    repoId: "repo_session_git",
  });
  return { db, ctx, repoPath, sessionId: session.id };
};

const teardown = async (db: Awaited<ReturnType<typeof createTestDb>>, repoPath: string) => {
  await db.destroy();
  await rm(repoPath, { recursive: true, force: true });
};

describe("getSessionGitStatus", () => {
  test("returns clean status on the default branch with no changes", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();

    const result = await getSessionGitStatus(ctx, sessionId, defaultRunGit, unavailableGh);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.status).toEqual({
      isGitRepo: true,
      branch: "main",
      defaultBranch: "main",
      isOnDefaultBranch: true,
      dirty: false,
      diffstat: { filesChanged: 0, additions: 0, deletions: 0 },
      aheadOfBase: 0,
      ghAvailable: false,
      pr: null,
      prState: null,
    });

    await teardown(db, repoPath);
  });

  test("reports dirty working-tree diffstat against the merge base", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    await writeFile(join(repoPath, "readme.md"), "hello\nworld\n");
    await runGit(repoPath, "add", "readme.md");

    const result = await getSessionGitStatus(ctx, sessionId, defaultRunGit, unavailableGh);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.status.isGitRepo).toBe(true);
    expect(result.status.branch).toBe("main");
    expect(result.status.dirty).toBe(true);
    expect(result.status.diffstat.filesChanged).toBe(1);
    expect(result.status.diffstat.additions).toBe(2);
    expect(result.status.diffstat.deletions).toBe(0);
    expect(result.status.aheadOfBase).toBe(0);
    expect(result.status.prState).toBeNull();

    await teardown(db, repoPath);
  });

  test("reports ahead-of-base commits and their diffstat on a feature branch", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    await runGit(repoPath, "switch", "-c", "feature/ahead");
    await writeFile(join(repoPath, "feature.ts"), "export const x = 1;\nexport const y = 2;\n");
    await runGit(repoPath, "add", "feature.ts");
    await runGit(repoPath, "commit", "-m", "add feature");

    const result = await getSessionGitStatus(ctx, sessionId, defaultRunGit, unavailableGh);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.status).toMatchObject({
      isGitRepo: true,
      branch: "feature/ahead",
      defaultBranch: "main",
      isOnDefaultBranch: false,
      dirty: false,
      aheadOfBase: 1,
      ghAvailable: false,
      pr: null,
      prState: null,
    });
    expect(result.status.diffstat.filesChanged).toBe(1);
    expect(result.status.diffstat.additions).toBe(2);
    expect(result.status.diffstat.deletions).toBe(0);

    await teardown(db, repoPath);
  });

  test("returns not found for an unknown session", async () => {
    const { db, ctx, repoPath } = await setupSession();

    const result = await getSessionGitStatus(ctx, "csess_missing", defaultRunGit, unavailableGh);
    expect(result).toEqual({
      success: false,
      error: { code: "SESSION_NOT_FOUND" },
    });

    await teardown(db, repoPath);
  });

  test("returns non-git status for a non-repository workspace path", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const workspace = join(tmpdir(), `aop-nongit-${crypto.randomUUID()}`);
    await mkdir(workspace, { recursive: true });

    const session = await createSession(ctx, {
      id: `csess_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      repoId: null,
      workspacePath: workspace,
    });

    const result = await getSessionGitStatus(ctx, session.id, defaultRunGit, unavailableGh);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status).toEqual({
      isGitRepo: false,
      branch: null,
      defaultBranch: null,
      isOnDefaultBranch: false,
      dirty: false,
      diffstat: { filesChanged: 0, additions: 0, deletions: 0 },
      aheadOfBase: 0,
      ghAvailable: false,
      pr: null,
      prState: null,
    });

    await db.destroy();
    await rm(workspace, { recursive: true, force: true });
  });

  test("reports the open pull request for a feature branch when gh is available", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    await runGit(repoPath, "switch", "-c", "feature/pr");
    await writeFile(join(repoPath, "pr.ts"), "export const pr = true;\n");
    await runGit(repoPath, "add", "pr.ts");
    await runGit(repoPath, "commit", "-m", "pr change");

    const ghCalls: string[][] = [];
    const fakeGh: RunGh = async (args) => {
      ghCalls.push(args);
      if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "pr" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              url: "https://github.com/acme/widget/pull/42",
              state: "OPEN",
              title: "PR",
            },
          ]),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };

    const result = await getSessionGitStatus(ctx, sessionId, defaultRunGit, fakeGh);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.status.ghAvailable).toBe(true);
    expect(result.status.pr).toEqual({
      number: 42,
      url: "https://github.com/acme/widget/pull/42",
      state: "OPEN",
      title: "PR",
    });
    expect(result.status.prState).toBe("open");
    expect(ghCalls.some((args) => args[0] === "pr" && args[1] === "list")).toBe(true);

    await teardown(db, repoPath);
  });

  test("reuses the GitHub availability check across status reads", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();

    const ghCalls: string[][] = [];
    const fakeGh: RunGh = async (args) => {
      ghCalls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await getSessionGitStatus(ctx, sessionId, defaultRunGit, fakeGh);
    await getSessionGitStatus(ctx, sessionId, defaultRunGit, fakeGh);

    expect(ghCalls).toEqual([["auth", "status"]]);
    await teardown(db, repoPath);
  });

  test("skips the pull request lookup on the default branch even when gh is available", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();

    const ghCalls: string[][] = [];
    const fakeGh: RunGh = async (args) => {
      ghCalls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await getSessionGitStatus(ctx, sessionId, defaultRunGit, fakeGh);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.status.ghAvailable).toBe(true);
    expect(result.status.pr).toBeNull();
    expect(result.status.prState).toBeNull();
    expect(ghCalls).toEqual([["auth", "status"]]);

    await teardown(db, repoPath);
  });

  test("coalesces concurrent status reads and retries after a rejected request", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    await runGit(repoPath, "switch", "-c", "feature/coalesce");

    let gitStatusCalls = 0;
    let authCalls = 0;
    let failNext = true;
    const runGitSpy: typeof defaultRunGit = async (args, cwd) => {
      if (args[0] === "status") gitStatusCalls += 1;
      return defaultRunGit(args, cwd);
    };
    const fakeGh: RunGh = async (args) => {
      if (args[0] === "auth") {
        authCalls += 1;
        if (failNext) {
          failNext = false;
          throw new Error("auth flaky");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "no pr" };
    };

    // Overlapping calls share one status read and one auth check.
    const [first, second] = await Promise.all([
      getSessionGitStatus(ctx, sessionId, runGitSpy, fakeGh),
      getSessionGitStatus(ctx, sessionId, runGitSpy, fakeGh),
    ]);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(gitStatusCalls).toBe(1);
    expect(authCalls).toBe(1);

    // A later non-overlapping call performs a fresh status read.
    const third = await getSessionGitStatus(ctx, sessionId, runGitSpy, fakeGh);
    expect(third.success).toBe(true);
    expect(gitStatusCalls).toBe(2);

    await teardown(db, repoPath);
  });

  test("starts PR lookup without waiting for base-relative git work", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    await runGit(repoPath, "switch", "-c", "feature/parallel-pr");
    await writeFile(join(repoPath, "parallel.ts"), "export const n = 1;\n");
    await runGit(repoPath, "add", "parallel.ts");
    await runGit(repoPath, "commit", "-m", "parallel");

    let releaseAuth: (() => void) | undefined;
    const authGate = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    let prStartedBeforeMergeBase = false;
    let mergeBaseSeen = false;
    const events: string[] = [];

    const runGitSpy: typeof defaultRunGit = async (args, cwd) => {
      if (args[0] === "merge-base") {
        mergeBaseSeen = true;
        events.push("merge-base");
        await Bun.sleep(30);
        events.push("merge-base-done");
      }
      return defaultRunGit(args, cwd);
    };
    const fakeGh: RunGh = async (args) => {
      if (args[0] === "auth") {
        events.push("auth");
        await authGate;
        events.push("auth-done");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "list") {
        prStartedBeforeMergeBase = !events.includes("merge-base-done");
        events.push("pr-list");
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 7,
              url: "https://github.com/acme/widget/pull/7",
              state: "OPEN",
              title: "Parallel",
            },
          ]),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    };

    const pending = getSessionGitStatus(ctx, sessionId, runGitSpy, fakeGh);
    await Bun.sleep(5);
    releaseAuth?.();
    const result = await pending;
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.number).toBe(7);
    expect(
      prStartedBeforeMergeBase || events.indexOf("pr-list") < events.indexOf("merge-base-done"),
    ).toBe(true);
    expect(mergeBaseSeen).toBe(true);

    await teardown(db, repoPath);
  });

  test("evicts a rejected coalesced request so a later call retries", async () => {
    const { db, ctx, repoPath, sessionId } = await setupSession();
    let attempts = 0;
    const flakyGit: typeof defaultRunGit = async (args, cwd) => {
      if (args[0] === "status") {
        attempts += 1;
        if (attempts === 1) throw new Error("status failed");
      }
      return defaultRunGit(args, cwd);
    };

    await expect(getSessionGitStatus(ctx, sessionId, flakyGit, unavailableGh)).rejects.toThrow(
      "status failed",
    );
    const retry = await getSessionGitStatus(ctx, sessionId, flakyGit, unavailableGh);
    expect(retry.success).toBe(true);
    expect(attempts).toBe(2);

    await teardown(db, repoPath);
  });
});
