import type { RunCommand } from "../command-runner.ts";

export const CHECKPOINT_COMMAND_TIMEOUT_MS = 30_000;
export const CHECKPOINT_DIFF_LINE_CAP = 2_000;

export interface CheckpointGitOptions {
  runGit?: RunCommand;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

export interface CheckpointWorkspaceIdentity {
  workspacePath: string;
  worktreeRoot: string;
  gitCommonDirectory: string;
  branch: string | null;
  headCommit: string | null;
}

export interface WorkspaceCheckpointError {
  code:
    | "NON_GIT_WORKSPACE"
    | "INVALID_REF"
    | "MISSING_REF"
    | "WORKSPACE_IDENTITY_MISMATCH"
    | "INVALID_PATH"
    | "TIMEOUT"
    | "CANCELLED"
    | "GIT_COMMAND_FAILED";
  message: string;
  command?: string[];
  stderr?: string;
}

export type WorkspaceCheckpointResult<T> =
  | { success: true; value: T }
  | { success: false; error: WorkspaceCheckpointError };

export interface CapturedWorkspaceCheckpoint {
  ref: string;
  commitId: string;
  identity: CheckpointWorkspaceIdentity;
}

export interface ResolvedWorkspaceCheckpointRef {
  ref: string;
  commitId: string;
  identity: CheckpointWorkspaceIdentity;
}

export interface RestoredWorkspaceCheckpoint {
  ref: string;
  commitId: string;
  identity: CheckpointWorkspaceIdentity;
}
