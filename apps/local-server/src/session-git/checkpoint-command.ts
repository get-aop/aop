import {
  CommandCancelledError,
  type CommandResult,
  CommandTimeoutError,
  defaultGitRunner,
} from "../command-runner.ts";
import {
  CHECKPOINT_COMMAND_TIMEOUT_MS,
  type CheckpointGitOptions,
  type WorkspaceCheckpointError,
} from "./checkpoint-types.ts";

export class CheckpointFailure extends Error {
  constructor(readonly detail: WorkspaceCheckpointError) {
    super(detail.message);
    this.name = "CheckpointFailure";
  }
}

export const runCheckpointGit = async (
  args: string[],
  cwd: string,
  options: CheckpointGitOptions,
): Promise<CommandResult> => {
  if (options.signal?.aborted) {
    throw new CheckpointFailure({ code: "CANCELLED", message: "Checkpoint operation cancelled" });
  }
  try {
    return await (options.runGit ?? defaultGitRunner)(args, cwd, {
      env: options.env,
      timeoutMs: normalizeTimeout(options.timeoutMs),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof CommandTimeoutError) {
      throw new CheckpointFailure({
        code: "TIMEOUT",
        message: error.message,
        command: args,
      });
    }
    if (error instanceof CommandCancelledError || options.signal?.aborted) {
      throw new CheckpointFailure({
        code: "CANCELLED",
        message: "Checkpoint operation cancelled",
        command: args,
      });
    }
    throw error;
  }
};

export const requireGitSuccess = (
  result: CommandResult,
  args: string[],
  message: string,
): string => {
  if (result.exitCode !== 0) {
    throw new CheckpointFailure({
      code: "GIT_COMMAND_FAILED",
      message,
      command: args,
      stderr: result.stderr.trim(),
    });
  }
  return result.stdout.trim();
};

export const checkpointError = (error: unknown): WorkspaceCheckpointError => {
  if (error instanceof CheckpointFailure) return error.detail;
  throw error;
};

const normalizeTimeout = (timeoutMs: number | undefined): number =>
  Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.floor(timeoutMs ?? CHECKPOINT_COMMAND_TIMEOUT_MS)
    : CHECKPOINT_COMMAND_TIMEOUT_MS;
