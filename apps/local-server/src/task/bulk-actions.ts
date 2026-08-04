import type { RepoBulkAction, RepoBulkActionResult } from "@aop/common";
import type { LocalServerContext } from "../context.ts";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunGit = (args: string[], cwd: string) => Promise<CommandResult>;

export interface RepoBulkActionDeps {
  runGit: RunGit;
}

const defaultRunGit: RunGit = async (args, cwd) => {
  const result = await Bun.$`git ${args}`.cwd(cwd).quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const defaultDeps = (): RepoBulkActionDeps => ({
  runGit: defaultRunGit,
});

/**
 * Repo-level actions. PR create/merge/fix used to live here; operators now
 * handle those through chat. Only git-pull remains as a non-PR pool action.
 */
export const runRepoBulkAction = async (
  ctx: LocalServerContext,
  repoId: string,
  action: RepoBulkAction,
  deps: RepoBulkActionDeps = defaultDeps(),
): Promise<RepoBulkActionResult> => {
  if (action === "git-pull") {
    return runRepoGitPull(ctx, repoId, deps);
  }
  // Exhaustiveness: only git-pull is supported.
  const _never: never = action;
  throw new Error(`Unsupported bulk action: ${String(_never)}`);
};

const runRepoGitPull = async (
  ctx: LocalServerContext,
  repoId: string,
  deps: RepoBulkActionDeps,
): Promise<RepoBulkActionResult> => {
  const result: RepoBulkActionResult = {
    action: "git-pull",
    total: 1,
    started: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const repo = await ctx.repoRepository.getById(repoId);
  if (!repo) {
    result.failed = 1;
    result.failures.push({ taskId: repoId, error: "Repo not found" });
    return result;
  }

  try {
    const pull = await deps.runGit(["pull", "--ff-only"], repo.path);
    if (pull.exitCode === 0) {
      result.started = 1;
      return result;
    }

    result.failed = 1;
    result.failures.push({
      taskId: repoId,
      error: pull.stderr.trim() || pull.stdout.trim() || "git pull failed",
    });
    return result;
  } catch (error) {
    result.failed = 1;
    result.failures.push({
      taskId: repoId,
      error: error instanceof Error ? error.message : "git pull failed",
    });
    return result;
  }
};
