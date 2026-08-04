import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalServerContext } from "../context.ts";
import { createTestContext } from "../db/test-utils.ts";
import {
  captureWorkspaceCheckpoint,
  resolveCheckpointWorkspaceIdentity,
} from "../session-git/checkpoints.ts";
import { processCheckpointCleanupJobs } from "./checkpoint-cleanup-service.ts";
import {
  listOrphanChatHistory,
  purgeAllChatHistory,
  purgeRepoChatHistory,
} from "./history-maintenance.ts";
import { SessionMutationBlockedError } from "./session-mutation-lock.ts";
import {
  countChatRows,
  listCleanupJobs,
  revertBackupRef,
  runCheckpointRef,
  seedChatSessionGraph,
  seedRevertOperation,
} from "./test-utils.ts";

const REPO = "repo_1";
const SESSION = "csess_repo";
const temporaryDirectories: string[] = [];

describe("chat history maintenance", () => {
  let ctx: LocalServerContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.db.destroy();
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("a successful repo purge deletes every chat row and every hidden ref", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 2);
    await seedChatSessionGraph(ctx.db, { sessionId: "csess_other_repo", repoId: "repo_2" });

    const result = await purgeRepoChatHistory(ctx, REPO);

    expect(result).toMatchObject({ success: true, deletedSessionIds: [SESSION] });
    expect(await countChatRows(ctx.db)).toMatchObject({
      chat_messages: 2,
      chat_runs: 1,
      chat_run_events: 1,
      chat_run_changed_files: 1,
      chat_run_checkpoints: 1,
      chat_revert_operations: 0,
    });
    expect(await ctx.db.selectFrom("chat_sessions").select("id").execute()).toEqual([
      { id: "csess_other_repo" },
    ]);
    for (const runId of seeded.runIds) {
      expect(await refExists(repo, runCheckpointRef(SESSION, runId, "before"))).toBe(false);
      expect(await refExists(repo, runCheckpointRef(SESSION, runId, "after"))).toBe(false);
    }
    expect((await listCleanupJobs(ctx.db)).every((job) => job.status === "completed")).toBe(true);
  });

  test("a repo purge preflight failure preserves every repo-owned row", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 1);
    await seedRevertOperation(ctx.db, {
      id: "crev_bad",
      sessionId: SESSION,
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
      refsToDeleteJson: "{not json",
    });
    const before = await countChatRows(ctx.db);

    const result = await purgeRepoChatHistory(ctx, REPO);

    expect(result).toMatchObject({ success: false, error: { reason: "preflight-failed" } });
    expect(await countChatRows(ctx.db)).toEqual(before);
    expect(await listCleanupJobs(ctx.db)).toEqual([]);
    expect(
      await refExists(repo, runCheckpointRef(SESSION, seeded.runIds[0] as string, "before")),
    ).toBe(true);
  });

  test("a repo cleanup failure preserves the session data needed to retry", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 1);
    const before = await countChatRows(ctx.db);

    const result = await purgeRepoChatHistory(ctx, REPO, {
      processJobs: async () => ({ completedJobIds: [], failedJobIds: [] }),
    });

    expect(result).toMatchObject({ success: false, error: { reason: "cleanup-failed" } });
    expect(await countChatRows(ctx.db)).toEqual(before);
    // The job stays durable so a later retry can finish the deletion.
    const jobs = await listCleanupJobs(ctx.db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("pending");
    expect(
      await refExists(repo, runCheckpointRef(SESSION, seeded.runIds[0] as string, "before")),
    ).toBe(true);
  });

  test("cleanup runs before deletion so a git failure keeps all user rows", async () => {
    const repo = await createGitRepository();
    await seedSessionInRepository(ctx, repo, SESSION, 1);
    await rm(repo, { recursive: true, force: true });
    const before = await countChatRows(ctx.db);

    const result = await purgeAllChatHistory(ctx);

    expect(result).toMatchObject({ success: false, error: { reason: "cleanup-failed" } });
    expect(await countChatRows(ctx.db)).toEqual(before);
    const jobs = await listCleanupJobs(ctx.db);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.error_message).toContain("WORKSPACE_UNAVAILABLE");
  });

  test("a reset refuses to run while an orphan checkpoint exists", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 1);
    await ctx.db
      .deleteFrom("chat_runs")
      .where("id", "=", seeded.runIds[0] as string)
      .execute();
    const before = await countChatRows(ctx.db);

    expect((await listOrphanChatHistory(ctx.db)).checkpointRunIds).toEqual([
      seeded.runIds[0] as string,
    ]);
    const result = await purgeAllChatHistory(ctx);

    expect(result).toMatchObject({ success: false, error: { reason: "preflight-failed" } });
    expect(await countChatRows(ctx.db)).toEqual(before);
    expect(await listCleanupJobs(ctx.db)).toEqual([]);
  });

  test("a reset refuses to run while an orphan revert operation exists", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 1);
    await seedRevertOperation(ctx.db, {
      id: "crev_orphan",
      sessionId: "csess_gone",
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
    });
    const before = await countChatRows(ctx.db);

    expect((await listOrphanChatHistory(ctx.db)).revertOperationIds).toEqual(["crev_orphan"]);
    const result = await purgeAllChatHistory(ctx);

    expect(result).toMatchObject({ success: false, error: { reason: "preflight-failed" } });
    expect(await countChatRows(ctx.db)).toEqual(before);
  });

  test("a successful reset removes every session only after its refs are gone", async () => {
    const repo = await createGitRepository();
    const seeded = await seedSessionInRepository(ctx, repo, SESSION, 1);
    await seedRevertOperation(ctx.db, {
      id: "crev_ok",
      sessionId: SESSION,
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
      status: "applied",
    });
    await capture(repo, revertBackupRef(SESSION, "crev_ok"));

    const result = await purgeAllChatHistory(ctx);

    expect(result).toMatchObject({ success: true, deletedSessionIds: [SESSION] });
    expect(await countChatRows(ctx.db)).toMatchObject({
      chat_sessions: 0,
      chat_messages: 0,
      chat_runs: 0,
      chat_run_events: 0,
      chat_run_changed_files: 0,
      chat_run_checkpoints: 0,
      chat_revert_operations: 0,
    });
    expect(await refExists(repo, revertBackupRef(SESSION, "crev_ok"))).toBe(false);
    expect(
      await refExists(repo, runCheckpointRef(SESSION, seeded.runIds[0] as string, "before")),
    ).toBe(false);
    expect(await listOrphanChatHistory(ctx.db)).toEqual({
      checkpointRunIds: [],
      revertOperationIds: [],
    });
  });

  test("no chat mutation can cross the repo-removal barrier", async () => {
    const repo = await createGitRepository();
    await seedSessionInRepository(ctx, repo, SESSION, 1);
    const blocked: string[] = [];

    const result = await purgeRepoChatHistory(ctx, REPO, {
      // Runs after preflight and job persistence, while the barrier is up.
      processJobs: (deps, options) => {
        blocked.push(...recordBlockedMutations(ctx));
        return processCheckpointCleanupJobs(deps, options);
      },
    });

    expect(result.success).toBe(true);
    expect(blocked.sort()).toEqual(["create", "retry", "send", "steer-claim", "workspace"]);
  });

  test("a global reset barrier blocks new sessions for every repo", async () => {
    const lock = ctx.sessionMutationLock;
    const inside = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const maintenance = lock.withMaintenance(
      { kind: "global" },
      async () => [],
      async () => {
        inside.resolve();
        await release.promise;
      },
    );
    await inside.promise;
    expect(() => lock.assertAllowed("create", { repoId: "repo_9" })).toThrow(
      SessionMutationBlockedError,
    );
    release.resolve();
    await maintenance;
  });
});

const recordBlockedMutations = (ctx: LocalServerContext): string[] => {
  const blocked: string[] = [];
  for (const [label, attempt] of mutationAttempts(ctx)) {
    try {
      attempt();
    } catch (error) {
      if (error instanceof SessionMutationBlockedError) blocked.push(label);
    }
  }
  return blocked;
};

const mutationAttempts = (ctx: LocalServerContext): Array<[string, () => void]> => [
  ["send", () => ctx.sessionMutationLock.assertAllowed("send", { sessionId: SESSION })],
  ["retry", () => ctx.sessionMutationLock.assertAllowed("retry", { sessionId: SESSION })],
  [
    "steer-claim",
    () => ctx.sessionMutationLock.assertAllowed("steer-claim", { sessionId: SESSION }),
  ],
  ["workspace", () => ctx.sessionMutationLock.assertAllowed("workspace", { sessionId: SESSION })],
  ["create", () => ctx.sessionMutationLock.assertAllowed("create", { repoId: REPO })],
];

const seedSessionInRepository = async (
  ctx: LocalServerContext,
  repo: string,
  sessionId: string,
  turns: number,
) => {
  const identity = await resolveCheckpointWorkspaceIdentity({ workspacePath: repo });
  if (!identity.success) throw new Error("failed to resolve identity");
  const seeded = await seedChatSessionGraph(ctx.db, {
    sessionId,
    repoId: REPO,
    turns,
    workspacePath: identity.value.workspacePath,
    worktreeRoot: identity.value.worktreeRoot,
    gitCommonDir: identity.value.gitCommonDirectory,
  });
  for (const runId of seeded.runIds) {
    await capture(repo, runCheckpointRef(sessionId, runId, "before"));
    await capture(repo, runCheckpointRef(sessionId, runId, "after"));
  }
  return seeded;
};

const capture = async (repo: string, ref: string): Promise<void> => {
  const captured = await captureWorkspaceCheckpoint({ workspacePath: repo, ref });
  if (!captured.success) throw new Error(`Failed to capture ${ref}: ${captured.error.message}`);
};

const refExists = async (repo: string, ref: string): Promise<boolean> => {
  const process = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", ref], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await process.exited) === 0;
};

const createGitRepository = async (): Promise<string> => {
  const repo = await mkdtemp(join(tmpdir(), "aop-maintenance-test-"));
  temporaryDirectories.push(repo);
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "AOP Test");
  await git(repo, "config", "user.email", "test@aop.local");
  await writeFile(join(repo, "tracked.txt"), "original\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  return repo;
};

const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
};
