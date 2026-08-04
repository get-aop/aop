import { mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  CheckpointFailure,
  checkpointError,
  requireGitSuccess,
  runCheckpointGit,
} from "./checkpoint-command.ts";
import { validateWorkspaceCheckpointRef } from "./checkpoint-refs.ts";
import type {
  CapturedWorkspaceCheckpoint,
  CheckpointGitOptions,
  CheckpointWorkspaceIdentity,
  ResolvedWorkspaceCheckpointRef,
  RestoredWorkspaceCheckpoint,
  WorkspaceCheckpointResult,
} from "./checkpoint-types.ts";

export type {
  CheckpointRefSide,
  ParsedCheckpointRef,
  RevertBackupCheckpointRef,
  RunCheckpointRef,
} from "./checkpoint-refs.ts";
export {
  buildRevertBackupCheckpointRef,
  buildRunCheckpointRef,
  isWorkspaceCheckpointRef,
  parseWorkspaceCheckpointRef,
  validateWorkspaceCheckpointRef,
} from "./checkpoint-refs.ts";
export type {
  CapturedWorkspaceCheckpoint,
  CheckpointGitOptions,
  CheckpointWorkspaceIdentity,
  ResolvedWorkspaceCheckpointRef,
  RestoredWorkspaceCheckpoint,
  WorkspaceCheckpointError,
  WorkspaceCheckpointResult,
} from "./checkpoint-types.ts";

interface WorkspaceInput extends CheckpointGitOptions {
  workspacePath: string;
}

interface RefInput extends WorkspaceInput {
  ref: string;
}

export const resolveCheckpointWorkspaceIdentity = async (
  input: WorkspaceInput,
): Promise<WorkspaceCheckpointResult<CheckpointWorkspaceIdentity>> => {
  try {
    return { success: true, value: await resolveIdentity(input) };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

export const captureWorkspaceCheckpoint = async (
  input: RefInput & { message?: string },
): Promise<WorkspaceCheckpointResult<CapturedWorkspaceCheckpoint>> => {
  try {
    const ref = validateWorkspaceCheckpointRef(input.ref);
    const identity = await resolveIdentity(input);
    const temporaryDirectory = await mkdtemp(join(identity.gitCommonDirectory, "aop-checkpoint-"));
    const temporaryIndex = join(temporaryDirectory, "index");
    const indexOptions = withEnvironment(input, { GIT_INDEX_FILE: temporaryIndex });

    try {
      if (identity.headCommit) {
        await successfulGit(["read-tree", "HEAD"], identity.workspacePath, indexOptions);
      }
      await successfulGit(["add", "-A", "--", "."], identity.workspacePath, indexOptions);
      const tree = await successfulGit(["write-tree"], identity.workspacePath, indexOptions);
      const commitId = await successfulGit(
        ["commit-tree", tree, "-m", input.message ?? "AOP workspace checkpoint"],
        identity.workspacePath,
        withEnvironment(input, CHECKPOINT_AUTHOR_ENVIRONMENT),
      );
      await successfulGit(["update-ref", ref, commitId], identity.workspacePath, input);
      return { success: true, value: { ref, commitId, identity } };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

export const resolveWorkspaceCheckpointRef = async (
  input: RefInput,
): Promise<WorkspaceCheckpointResult<ResolvedWorkspaceCheckpointRef>> => {
  try {
    const ref = validateWorkspaceCheckpointRef(input.ref);
    const identity = await resolveIdentity(input);
    const commitId = await resolveCheckpointCommit(ref, identity.workspacePath, input);
    return { success: true, value: { ref, commitId, identity } };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

export const restoreWorkspaceCheckpoint = async (
  input: RefInput & { expectedIdentity: CheckpointWorkspaceIdentity },
): Promise<WorkspaceCheckpointResult<RestoredWorkspaceCheckpoint>> => {
  try {
    const ref = validateWorkspaceCheckpointRef(input.ref);
    const identity = await resolveIdentity(input);
    requireMatchingWorkspace(input.expectedIdentity, identity);
    const commitId = await resolveCheckpointCommit(ref, identity.workspacePath, input);

    await successfulGit(
      ["restore", "--source", commitId, "--worktree", "--staged", "--", "."],
      identity.workspacePath,
      input,
    );
    await successfulGit(["clean", "-fd", "--", "."], identity.workspacePath, input);
    if (identity.headCommit) {
      await successfulGit(["reset", "--quiet", "--", "."], identity.workspacePath, input);
    }
    return { success: true, value: { ref, commitId, identity } };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

export const deleteWorkspaceCheckpointRefs = async (
  input: WorkspaceInput & { refs: string[] },
): Promise<WorkspaceCheckpointResult<{ deletedRefs: string[] }>> => {
  try {
    const refs = input.refs.map(validateWorkspaceCheckpointRef);
    const identity = await resolveIdentity(input);
    for (const ref of refs) {
      await successfulGit(["update-ref", "-d", ref], identity.workspacePath, input);
    }
    return { success: true, value: { deletedRefs: refs } };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

const resolveIdentity = async (input: WorkspaceInput): Promise<CheckpointWorkspaceIdentity> => {
  const workspacePath = await canonicalPath(input.workspacePath);
  const insideArgs = ["rev-parse", "--is-inside-work-tree"];
  const inside = await runCheckpointGit(insideArgs, workspacePath, input);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    throw new CheckpointFailure({
      code: "NON_GIT_WORKSPACE",
      message: `Path is not inside a git worktree: ${workspacePath}`,
      command: insideArgs,
      stderr: inside.stderr.trim(),
    });
  }

  const worktreeRootRaw = await successfulGit(
    ["rev-parse", "--show-toplevel"],
    workspacePath,
    input,
  );
  const commonDirectoryRaw = await successfulGit(
    ["rev-parse", "--git-common-dir"],
    workspacePath,
    input,
  );
  const branchResult = await runCheckpointGit(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    workspacePath,
    input,
  );
  const headResult = await runCheckpointGit(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    workspacePath,
    input,
  );

  return {
    workspacePath,
    worktreeRoot: await canonicalPath(worktreeRootRaw),
    gitCommonDirectory: await canonicalPath(
      isAbsolute(commonDirectoryRaw)
        ? commonDirectoryRaw
        : resolve(workspacePath, commonDirectoryRaw),
    ),
    branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    headCommit: headResult.exitCode === 0 ? headResult.stdout.trim() || null : null,
  };
};

const resolveCheckpointCommit = async (
  ref: string,
  workspacePath: string,
  options: CheckpointGitOptions,
): Promise<string> => {
  const args = ["rev-parse", "--verify", `${ref}^{commit}`];
  const result = await runCheckpointGit(args, workspacePath, options);
  if (result.exitCode !== 0) {
    throw new CheckpointFailure({
      code: "MISSING_REF",
      message: `Workspace checkpoint ref does not exist: ${ref}`,
      command: args,
      stderr: result.stderr.trim(),
    });
  }
  return result.stdout.trim();
};

const requireMatchingWorkspace = (
  expected: CheckpointWorkspaceIdentity,
  actual: CheckpointWorkspaceIdentity,
): void => {
  if (
    expected.workspacePath === actual.workspacePath &&
    expected.worktreeRoot === actual.worktreeRoot &&
    expected.gitCommonDirectory === actual.gitCommonDirectory
  ) {
    return;
  }
  throw new CheckpointFailure({
    code: "WORKSPACE_IDENTITY_MISMATCH",
    message: "Checkpoint was captured from a different workspace or worktree",
  });
};

const successfulGit = async (
  args: string[],
  cwd: string,
  options: CheckpointGitOptions,
): Promise<string> =>
  requireGitSuccess(
    await runCheckpointGit(args, cwd, options),
    args,
    `Git command failed: ${args[0]}`,
  );

const canonicalPath = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    throw new CheckpointFailure({
      code: "NON_GIT_WORKSPACE",
      message: `Workspace path does not exist: ${path}`,
    });
  }
};

const withEnvironment = (
  options: CheckpointGitOptions,
  env: Record<string, string>,
): CheckpointGitOptions => ({
  ...options,
  runGit: options.runGit,
  env,
});

const CHECKPOINT_AUTHOR_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "AOP Checkpoint",
  GIT_AUTHOR_EMAIL: "checkpoint@aop.local",
  GIT_COMMITTER_NAME: "AOP Checkpoint",
  GIT_COMMITTER_EMAIL: "checkpoint@aop.local",
};
