import { getLogger } from "@aop/infra";
import type { BranchOps } from "./branch-ops.ts";
import {
  BranchNotFoundError,
  DirtyWorktreeError,
  WorktreeExistsError,
  WorktreeNotFoundError,
} from "./errors.ts";
import type { GitExecutor } from "./git-executor.ts";
import type { MetadataStore } from "./metadata.ts";
import type { WorktreeInfo } from "./types.ts";
import { validateTaskId } from "./validation.ts";

const logger = getLogger("worktree-ops");

/**
 * Worktree create/remove lifecycle operations.
 */
export class WorktreeOps {
  constructor(
    private readonly worktreesDir: string,
    private readonly executor: GitExecutor,
    private readonly branchOps: BranchOps,
    private readonly metadata: MetadataStore,
  ) {}

  /**
   * A new `branchName` starts at `baseBranch`, a local branch or a remote-tracking one such as
   * `origin/main`; a `branchName` that exists is checked out as it is.
   */
  async create(taskId: string, baseBranch: string, branchName = taskId): Promise<WorktreeInfo> {
    validateTaskId(taskId);

    if (!(await this.branchOps.isStartPoint(baseBranch))) {
      throw new BranchNotFoundError(baseBranch);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    if (await this.exists(taskId)) {
      throw new WorktreeExistsError(taskId);
    }

    await this.ensureWorktreesDir();

    const baseCommit = await this.branchOps.getCommit(baseBranch);
    if (await this.branchOps.exists(branchName)) {
      // Worktree path may have been removed manually while the task branch still exists.
      await this.executor.exec(["worktree", "add", worktreePath, branchName]);
    } else {
      // No upstream: git would make a remote-tracking base the new branch's upstream, and a bare
      // `git push` in the worktree could then publish its work straight to that base.
      await this.executor.exec([
        "worktree",
        "add",
        "--no-track",
        "-b",
        branchName,
        worktreePath,
        baseBranch,
      ]);
    }
    await this.metadata.save(taskId, { branch: branchName, baseBranch, baseCommit });

    logger.info("Created worktree {taskId} at {path}", { taskId, path: worktreePath });

    return { path: worktreePath, branch: branchName, baseBranch, baseCommit };
  }

  async remove(taskId: string): Promise<void> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const metadata = await this.metadata.get(taskId);
    if (await this.hasUncommittedChanges(worktreePath)) {
      throw new DirtyWorktreeError(taskId);
    }

    await this.executor.exec(["worktree", "remove", worktreePath]);
    await this.executor.exec(["branch", "-D", metadata.branch]);
    await this.metadata.delete(taskId);

    logger.info("Removed worktree {taskId}", { taskId });
  }

  async exists(taskId: string): Promise<boolean> {
    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const result = await Bun.$`test -d ${worktreePath}`.quiet().nothrow();
    return result.exitCode === 0;
  }

  private async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const result = await Bun.$`git status --porcelain`.cwd(worktreePath).quiet().nothrow();
    return result.stdout.toString().trim().length > 0;
  }

  private async ensureWorktreesDir(): Promise<void> {
    const result = await Bun.$`test -d ${this.worktreesDir}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      await Bun.$`mkdir -p ${this.worktreesDir}`.quiet();
      logger.debug("Created worktrees directory");
    }
  }
}
