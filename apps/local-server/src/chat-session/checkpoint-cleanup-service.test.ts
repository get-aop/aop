import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { NewChatCheckpointCleanupJob } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  captureWorkspaceCheckpoint,
  deleteWorkspaceCheckpointRefs,
  resolveCheckpointWorkspaceIdentity,
} from "../session-git/checkpoints.ts";
import {
  type ChatCheckpointCleanupRepository,
  createChatCheckpointCleanupRepository,
} from "./checkpoint-cleanup-repository.ts";
import {
  processCheckpointCleanupJobs,
  runStartupCheckpointCleanup,
} from "./checkpoint-cleanup-service.ts";
import { revertBackupRef, runCheckpointRef } from "./test-utils.ts";

const SESSION = "csess_cleanup";
const RUN = "crun_cleanup";
const BEFORE_REF = runCheckpointRef(SESSION, RUN, "before");
const AFTER_REF = runCheckpointRef(SESSION, RUN, "after");
const BACKUP_REF = revertBackupRef(SESSION, "crev_cleanup");
const NOW = "2026-07-24T10:00:00.000Z";

const temporaryDirectories: string[] = [];

describe("checkpoint cleanup service", () => {
  let db: Kysely<Database>;
  let repository: ChatCheckpointCleanupRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createChatCheckpointCleanupRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("deletes hidden refs and completes the job", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    await capture(repo, AFTER_REF);
    await capture(repo, BACKUP_REF);
    await repository.create(await jobFor(repo, [BEFORE_REF, AFTER_REF, BACKUP_REF]));

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.failedJobIds).toEqual([]);
    expect(result.completedJobIds).toHaveLength(1);
    expect(await refExists(repo, BEFORE_REF)).toBe(false);
    expect(await refExists(repo, AFTER_REF)).toBe(false);
    expect(await refExists(repo, BACKUP_REF)).toBe(false);
    expect(await repository.listUnfinished()).toEqual([]);
  });

  test("deleting an already absent ref stays idempotent", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    await deleteWorkspaceCheckpointRefs({ workspacePath: repo, refs: [BEFORE_REF] });
    await repository.create(await jobFor(repo, [BEFORE_REF, AFTER_REF]));

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.completedJobIds).toHaveLength(1);
    expect(result.failedJobIds).toEqual([]);
  });

  test("malformed refs_json fails safely without touching git", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    const job = await jobFor(repo, [BEFORE_REF]);
    await repository.create({ ...job, refs_json: "{not json" });

    let deleteCalls = 0;
    const result = await processCheckpointCleanupJobs({
      repository,
      deleteRefs: async (input) => {
        deleteCalls += 1;
        return deleteWorkspaceCheckpointRefs(input);
      },
    });

    expect(deleteCalls).toBe(0);
    expect(result.failedJobIds).toEqual([job.id]);
    expect(await refExists(repo, BEFORE_REF)).toBe(true);
    const [row] = await repository.listByIds([job.id]);
    expect(row?.status).toBe("failed");
    expect(row?.error_message).toContain("MALFORMED_REFS_JSON");
  });

  test("a ref owned by another session fails the job", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    const job = await jobFor(repo, [BEFORE_REF]);
    await repository.create({ ...job, session_ids_json: JSON.stringify(["csess_other"]) });

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.failedJobIds).toEqual([job.id]);
    expect(await refExists(repo, BEFORE_REF)).toBe(true);
  });

  test("a missing workspace fails without completing the job", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    const job = await jobFor(repo, [BEFORE_REF]);
    await repository.create(job);
    await rm(repo, { recursive: true, force: true });

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.completedJobIds).toEqual([]);
    expect(result.failedJobIds).toEqual([job.id]);
    const [row] = await repository.listByIds([job.id]);
    expect(row?.status).toBe("failed");
    expect(row?.error_message).toContain("WORKSPACE_UNAVAILABLE");
  });

  test("a replaced workspace with a different common dir is never modified", async () => {
    const original = await createRepository();
    await capture(original, BEFORE_REF);
    const replacement = await createRepository();
    await capture(replacement, BEFORE_REF);

    const job = await jobFor(original, [BEFORE_REF]);
    const identity = await requireIdentity(replacement);
    // Same stored workspace path, but the repository behind it is a different one.
    await repository.create({ ...job, workspace_path: identity.workspacePath });

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.completedJobIds).toEqual([]);
    expect(result.failedJobIds).toEqual([job.id]);
    expect(await refExists(replacement, BEFORE_REF)).toBe(true);
    const [row] = await repository.listByIds([job.id]);
    expect(row?.error_message).toContain("IDENTITY_MISMATCH");
  });

  test("a git failure is retried successfully on the next pass", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    const job = await jobFor(repo, [BEFORE_REF]);
    await repository.create(job);

    const failing = await processCheckpointCleanupJobs({
      repository,
      deleteRefs: async () => ({
        success: false,
        error: { code: "GIT_COMMAND_FAILED", message: "ref is locked" },
      }),
    });
    expect(failing.failedJobIds).toEqual([job.id]);
    expect(await refExists(repo, BEFORE_REF)).toBe(true);

    const retried = await processCheckpointCleanupJobs({ repository });
    expect(retried.completedJobIds).toEqual([job.id]);
    expect(await refExists(repo, BEFORE_REF)).toBe(false);
    const [row] = await repository.listByIds([job.id]);
    expect(row?.attempts).toBe(2);
  });

  test("one failed job does not block another valid job", async () => {
    const healthy = await createRepository();
    const broken = await createRepository();
    await capture(healthy, BEFORE_REF);
    await capture(broken, BEFORE_REF);
    const healthyJob = await jobFor(healthy, [BEFORE_REF]);
    const brokenJob = await jobFor(broken, [BEFORE_REF]);
    await repository.createMany([brokenJob, healthyJob]);
    await rm(broken, { recursive: true, force: true });

    const result = await processCheckpointCleanupJobs({ repository });

    expect(result.completedJobIds).toEqual([healthyJob.id]);
    expect(result.failedJobIds).toEqual([brokenJob.id]);
    expect(await refExists(healthy, BEFORE_REF)).toBe(false);
  });

  test("startup retry recovers a claim abandoned mid-flight", async () => {
    const repo = await createRepository();
    await capture(repo, BEFORE_REF);
    const job = await jobFor(repo, [BEFORE_REF]);
    await repository.create(job);
    await db
      .updateTable("chat_checkpoint_cleanup_jobs")
      .set({ status: "processing", claim_token: "crashed", claimed_at: NOW })
      .where("id", "=", job.id)
      .execute();

    const result = await runStartupCheckpointCleanup(repository);

    expect(result?.completedJobIds).toEqual([job.id]);
    expect(await refExists(repo, BEFORE_REF)).toBe(false);
    expect(await repository.listUnfinished()).toEqual([]);
  });
});

const jobFor = async (repo: string, refs: string[]): Promise<NewChatCheckpointCleanupJob> => {
  const identity = await requireIdentity(repo);
  return {
    id: `cleanup_${refs.length}_${identity.workspacePath.replace(/[^A-Za-z0-9]/g, "")}`,
    workspace_path: identity.workspacePath,
    worktree_root: identity.worktreeRoot,
    git_common_dir: identity.gitCommonDirectory,
    refs_json: JSON.stringify(refs),
    session_ids_json: JSON.stringify([SESSION]),
    status: "pending",
    error_message: null,
    claim_token: null,
    claimed_at: null,
    attempts: 0,
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
  };
};

const requireIdentity = async (repo: string) => {
  const identity = await resolveCheckpointWorkspaceIdentity({ workspacePath: repo });
  if (!identity.success) throw new Error(`Failed to resolve identity for ${repo}`);
  return identity.value;
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

const createRepository = async (): Promise<string> => {
  const repo = await mkdtemp(join(tmpdir(), "aop-cleanup-test-"));
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
