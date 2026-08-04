import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandCancelledError, CommandTimeoutError, type RunCommand } from "../command-runner.ts";
import {
  buildRevertBackupCheckpointRef,
  buildRunCheckpointRef,
  parseWorkspaceCheckpointRef,
} from "./checkpoint-refs.ts";
import {
  captureWorkspaceCheckpoint,
  deleteWorkspaceCheckpointRefs,
  isWorkspaceCheckpointRef,
  resolveCheckpointWorkspaceIdentity,
  resolveWorkspaceCheckpointRef,
  restoreWorkspaceCheckpoint,
  validateWorkspaceCheckpointRef,
} from "./checkpoints.ts";

const temporaryDirectories: string[] = [];
const BEFORE_REF = "refs/aop/chat-checkpoints/csess_test/crun_test/before";
const AFTER_REF = "refs/aop/chat-checkpoints/csess_test/crun_test/after";
const BACKUP_REF = "refs/aop/chat-checkpoints/csess_test/reverts/op_test/backup";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace checkpoints", () => {
  test("captures every non-ignored workspace state without changing the real index", async () => {
    const repo = await createRepository();
    await writeFile(join(repo, "staged.txt"), "staged\n");
    await git(repo, "add", "staged.txt");
    await writeFile(join(repo, "tracked.txt"), "unstaged change\n");
    await rm(join(repo, "deleted.txt"));
    await git(repo, "mv", "rename-old.txt", "rename-new.txt");
    await writeFile(join(repo, "binary.bin"), new Uint8Array([0, 1, 2, 3]));
    await writeFile(join(repo, "untracked.txt"), "untracked\n");
    await writeFile(join(repo, "ignored.txt"), "ignored\n");

    const statusBefore = await git(repo, "status", "--porcelain=v1", "-uall");
    const indexBefore = await git(repo, "diff", "--cached", "--binary");
    const headBefore = await git(repo, "rev-parse", "HEAD");
    const capture = await captureWorkspaceCheckpoint({ workspacePath: repo, ref: BEFORE_REF });

    expect(capture.success).toBe(true);
    if (!capture.success) return;
    expect(await git(repo, "status", "--porcelain=v1", "-uall")).toBe(statusBefore);
    expect(await git(repo, "diff", "--cached", "--binary")).toBe(indexBefore);
    expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await git(repo, "branch", "--show-current")).toBe("main\n");

    const paths = await git(repo, "ls-tree", "-r", "--name-only", capture.value.commitId);
    expect(paths.split("\n").filter(Boolean).sort()).toEqual([
      ".gitignore",
      "binary.bin",
      "rename-new.txt",
      "staged.txt",
      "tracked.txt",
      "untracked.txt",
    ]);
    expect(await git(repo, "show", `${capture.value.commitId}:tracked.txt`)).toBe(
      "unstaged change\n",
    );
  });

  test("restores the snapshot, removes later untracked files, and keeps ignored files", async () => {
    const repo = await createRepository();
    await writeFile(join(repo, "tracked.txt"), "checkpoint version\n");
    await writeFile(join(repo, "snapshot-untracked.txt"), "snapshot\n");
    await writeFile(join(repo, "ignored.txt"), "ignored at capture\n");
    const capture = await captureWorkspaceCheckpoint({ workspacePath: repo, ref: BEFORE_REF });
    expect(capture.success).toBe(true);
    if (!capture.success) return;

    const headBefore = await git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "tracked.txt"), "later version\n");
    await rm(join(repo, "snapshot-untracked.txt"));
    await writeFile(join(repo, "later-untracked.txt"), "remove me\n");
    await writeFile(join(repo, "ignored.txt"), "keep latest ignored\n");

    const restored = await restoreWorkspaceCheckpoint({
      workspacePath: repo,
      ref: BEFORE_REF,
      expectedIdentity: capture.value.identity,
    });

    expect(restored.success).toBe(true);
    expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe("checkpoint version\n");
    expect(await readFile(join(repo, "snapshot-untracked.txt"), "utf8")).toBe("snapshot\n");
    expect(await Bun.file(join(repo, "later-untracked.txt")).exists()).toBe(false);
    expect(await readFile(join(repo, "ignored.txt"), "utf8")).toBe("keep latest ignored\n");
    expect(await git(repo, "diff", "--cached", "--name-only")).toBe("");
    expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await git(repo, "branch", "--show-current")).toBe("main\n");
  });

  test("resolves existing refs and deletes them idempotently", async () => {
    const repo = await createRepository();
    const capture = await captureWorkspaceCheckpoint({ workspacePath: repo, ref: BACKUP_REF });
    expect(capture.success).toBe(true);
    if (!capture.success) return;

    const resolved = await resolveWorkspaceCheckpointRef({ workspacePath: repo, ref: BACKUP_REF });
    expect(resolved.success).toBe(true);
    if (resolved.success) expect(resolved.value.commitId).toBe(capture.value.commitId);

    const firstDelete = await deleteWorkspaceCheckpointRefs({
      workspacePath: repo,
      refs: [BACKUP_REF],
    });
    const secondDelete = await deleteWorkspaceCheckpointRefs({
      workspacePath: repo,
      refs: [BACKUP_REF],
    });
    expect(firstDelete.success).toBe(true);
    expect(secondDelete.success).toBe(true);

    const missing = await resolveWorkspaceCheckpointRef({ workspacePath: repo, ref: BACKUP_REF });
    expect(missing).toMatchObject({ success: false, error: { code: "MISSING_REF" } });
  });

  test("captures an unborn repository", async () => {
    const repo = await createRepository(false);
    await writeFile(join(repo, "first.txt"), "first\n");

    const capture = await captureWorkspaceCheckpoint({ workspacePath: repo, ref: BEFORE_REF });

    expect(capture.success).toBe(true);
    if (!capture.success) return;
    expect(capture.value.identity.headCommit).toBeNull();
    expect(capture.value.identity.branch).toBe("main");
    expect(await git(repo, "show", `${capture.value.commitId}:first.txt`)).toBe("first\n");
  });

  test("rejects non-git paths, missing refs, and different worktree identities", async () => {
    const nonGit = await createTemporaryDirectory();
    const nonGitResult = await resolveCheckpointWorkspaceIdentity({ workspacePath: nonGit });
    expect(nonGitResult).toMatchObject({
      success: false,
      error: { code: "NON_GIT_WORKSPACE" },
    });

    const repo = await createRepository();
    const missing = await resolveWorkspaceCheckpointRef({ workspacePath: repo, ref: AFTER_REF });
    expect(missing).toMatchObject({ success: false, error: { code: "MISSING_REF" } });

    const capture = await captureWorkspaceCheckpoint({ workspacePath: repo, ref: BEFORE_REF });
    expect(capture.success).toBe(true);
    if (!capture.success) return;
    const mismatch = await restoreWorkspaceCheckpoint({
      workspacePath: repo,
      ref: BEFORE_REF,
      expectedIdentity: { ...capture.value.identity, workspacePath: `${repo}/other` },
    });
    expect(mismatch).toMatchObject({
      success: false,
      error: { code: "WORKSPACE_IDENTITY_MISMATCH" },
    });
  });

  test("passes a bounded timeout and returns typed timeout and cancellation failures", async () => {
    let observedTimeout: number | undefined;
    const timeoutRunner: RunCommand = async (_args, _cwd, options) => {
      observedTimeout = options?.timeoutMs;
      throw new CommandTimeoutError(options?.timeoutMs ?? 0);
    };
    const timedOut = await resolveCheckpointWorkspaceIdentity({
      workspacePath: process.cwd(),
      runGit: timeoutRunner,
    });
    expect(observedTimeout).toBe(30_000);
    expect(timedOut).toMatchObject({ success: false, error: { code: "TIMEOUT" } });

    const cancelledRunner: RunCommand = async () => {
      throw new CommandCancelledError();
    };
    const cancelled = await resolveCheckpointWorkspaceIdentity({
      workspacePath: process.cwd(),
      runGit: cancelledRunner,
    });
    expect(cancelled).toMatchObject({ success: false, error: { code: "CANCELLED" } });
  });
});

describe("validateWorkspaceCheckpointRef", () => {
  test("accepts run and revert backup refs", () => {
    expect(validateWorkspaceCheckpointRef(BEFORE_REF)).toBe(BEFORE_REF);
    expect(validateWorkspaceCheckpointRef(AFTER_REF)).toBe(AFTER_REF);
    expect(validateWorkspaceCheckpointRef(BACKUP_REF)).toBe(BACKUP_REF);
  });

  test("rejects traversal, empty segments, shortened refs, and other namespaces", () => {
    for (const ref of [
      "refs/aop/chat-checkpoints//run/before",
      "refs/aop/chat-checkpoints/session/../before",
      "refs/aop/chat-checkpoints/session/run/during",
      "refs/aop/chat-checkpoints/session/reverts//backup",
      // Shortened, session-less refs were only ever a test-fixture shape.
      "refs/aop/chat-checkpoints/run/before",
      "refs/aop/chat-checkpoints/revert/backup",
      "refs/heads/main",
    ]) {
      expect(() => validateWorkspaceCheckpointRef(ref), ref).toThrow();
      expect(isWorkspaceCheckpointRef(ref), ref).toBe(false);
    }
  });
});

describe("checkpoint ref ownership", () => {
  test("builders round-trip through the canonical parser", () => {
    expect(buildRunCheckpointRef("csess_test", "crun_test", "before")).toBe(BEFORE_REF);
    expect(buildRevertBackupCheckpointRef("csess_test", "op_test")).toBe(BACKUP_REF);
  });

  test("parses the session, run, and operation encoded in a ref", () => {
    expect(parseWorkspaceCheckpointRef(BEFORE_REF)).toEqual({
      kind: "run",
      ref: BEFORE_REF,
      sessionId: "csess_test",
      runId: "crun_test",
      side: "before",
    });
    expect(parseWorkspaceCheckpointRef(AFTER_REF)).toMatchObject({ side: "after" });
    expect(parseWorkspaceCheckpointRef(BACKUP_REF)).toEqual({
      kind: "revert-backup",
      ref: BACKUP_REF,
      sessionId: "csess_test",
      operationId: "op_test",
    });
    expect(parseWorkspaceCheckpointRef("refs/heads/main")).toBeNull();
  });
});

const createRepository = async (withInitialCommit = true): Promise<string> => {
  const repo = await createTemporaryDirectory();
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "AOP Test");
  await git(repo, "config", "user.email", "test@aop.local");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  if (withInitialCommit) {
    await writeFile(join(repo, "tracked.txt"), "original\n");
    await writeFile(join(repo, "deleted.txt"), "delete me\n");
    await writeFile(join(repo, "rename-old.txt"), "rename me\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "initial");
  }
  return repo;
};

const createTemporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "aop-checkpoint-test-"));
  temporaryDirectories.push(path);
  await mkdir(path, { recursive: true });
  return path;
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
