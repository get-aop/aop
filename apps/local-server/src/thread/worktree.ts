import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { suggestSessionBranchName } from "@aop/common";
import { BranchNotFoundError, GitManager, WorktreeExistsError } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import { resolveChatWorkspace } from "../chat-session/workspace-binding.ts";
import { type RunGit, stageAndCommitChanges } from "../session-git/service.ts";

const logger = getLogger("thread", "worktree");

/*
 * A thread's checkout on disk: one git worktree at `aopPaths.worktree(repoId, threadId)` on a
 * branch of its own. Every function here converges on its end state whatever an earlier,
 * interrupted call left behind, so a caller can simply run it again: `ensureWorktree` leaves
 * the worktree there, `releaseWorktree` leaves it (and, when asked, the branch) gone.
 */

export interface WorktreeRepo {
  id: string;
  path: string;
}

export type WorktreeResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

const BRANCH_ATTEMPTS = 20;

/**
 * `aop/<title>-<last six of the id>`, or the same with `-2`, `-3`... when a branch of that
 * name already exists and so cannot be this thread's: the name is only chosen once, at spawn.
 */
export const chooseBranchName = async (
  runGit: RunGit,
  repoPath: string,
  threadId: string,
  title: string,
): Promise<string> => {
  const base = suggestSessionBranchName(title, threadId);
  for (let attempt = 1; attempt <= BRANCH_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await branchExists(runGit, repoPath, candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
};

/**
 * Makes the thread's worktree exist on its branch. A worktree already there is left alone; a
 * missing one is created from the repo's default branch, or from the thread's branch when the
 * branch survived (a released worktree, a crash). A directory left half made is replaced.
 */
export const ensureWorktree = async (
  runGit: RunGit,
  repo: WorktreeRepo,
  threadId: string,
  branch: string,
): Promise<WorktreeResult<{ path: string }>> => {
  const path = aopPaths.worktree(repo.id, threadId);
  if (await isWorktreeOf(repo, path)) return { ok: true, path };
  try {
    const manager = new GitManager({ repoPath: repo.path, repoId: repo.id });
    await manager.init();
    // A directory with a `.git` in it was a worktree, and may hold work: it is not cleared for a
    // probe that failed. Only what git never finished (no `.git`) is.
    if (existsSync(join(path, ".git"))) {
      return {
        ok: false,
        message: `The worktree at ${path} exists but git cannot use it; it was left as it is`,
      };
    }
    await clearStaleCheckout(runGit, repo, path);
    await manager.createWorktree(threadId, await manager.getDefaultBranch(), branch);
    return { ok: true, path };
  } catch (error) {
    // Another call made it between the check and the create: the end state is the same.
    if (error instanceof WorktreeExistsError) return { ok: true, path };
    if (error instanceof BranchNotFoundError) {
      return {
        ok: false,
        message: `The default branch ${error.branch} does not exist in the repo`,
      };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

export interface ReleaseOptions {
  /** Keeps the branch and commits the worktree's pending changes to it first, so nothing is lost. */
  keepBranch?: boolean;
  /** Also deletes the branch on origin, best effort: for a branch whose pull request merged. */
  deleteRemote?: boolean;
  /** Names the commit that keeps pending changes. */
  title: string;
}

/** Removes the thread's worktree and, unless `keepBranch`, its branch. Nothing left to remove is not a failure. */
export const releaseWorktree = async (
  runGit: RunGit,
  repo: WorktreeRepo,
  threadId: string,
  branch: string | null,
  options: ReleaseOptions,
): Promise<WorktreeResult> => {
  const path = aopPaths.worktree(repo.id, threadId);
  if (!existsSync(repo.path)) return releaseWithoutRepo(repo, threadId, path, options);

  const removed = await removeWorktree(runGit, repo, path, options);
  if (!removed.ok) return removed;
  const deleted =
    branch && !options.keepBranch ? await removeBranch(runGit, repo, branch, options) : null;
  if (deleted && !deleted.ok) return deleted;
  await forgetMetadata(repo.id, threadId);
  return { ok: true };
};

// A repository path that cannot be reached is not proof that the repository is gone (a volume that
// is not mounted, a rename under way). Keeping the branch means keeping the work, so that waits;
// deleting the thread is asking for the work to go.
const releaseWithoutRepo = async (
  repo: WorktreeRepo,
  threadId: string,
  path: string,
  options: ReleaseOptions,
): Promise<WorktreeResult> => {
  if (options.keepBranch) {
    return {
      ok: false,
      message: `The repository is not reachable at ${repo.path}; its worktree was left as it is`,
    };
  }
  await rm(path, { recursive: true, force: true });
  await forgetMetadata(repo.id, threadId);
  return { ok: true };
};

const removeWorktree = async (
  runGit: RunGit,
  repo: WorktreeRepo,
  path: string,
  options: ReleaseOptions,
): Promise<WorktreeResult> => {
  if (existsSync(path)) {
    const kept = options.keepBranch
      ? await stageAndCommitChanges(runGit, path, options.title)
      : { ok: true as const };
    if (!kept.ok) return { ok: false, message: kept.error.message };
    await removeCheckout(runGit, repo, path);
  }
  await runGit(["worktree", "prune"], repo.path);
  return { ok: true };
};

const removeBranch = async (
  runGit: RunGit,
  repo: WorktreeRepo,
  branch: string,
  options: ReleaseOptions,
): Promise<WorktreeResult> => {
  const deleted = await runGit(["branch", "-D", branch], repo.path);
  if (deleted.exitCode !== 0 && (await branchExists(runGit, repo.path, branch))) {
    return { ok: false, message: deleted.stderr.trim() || `Could not delete branch ${branch}` };
  }
  // The remote goes last: deleting it also drops the remote-tracking ref that says what was
  // published, and a run that stopped before this can still tell.
  if (options.deleteRemote) await deleteRemoteBranch(runGit, repo.path, branch);
  return { ok: true };
};

/** True when `path` is a working tree of the repo, not merely a directory. */
const isWorktreeOf = async (repo: WorktreeRepo, path: string): Promise<boolean> => {
  if (!existsSync(path)) return false;
  try {
    await resolveChatWorkspace(repo.path, path);
    return true;
  } catch {
    return false;
  }
};

// What a crash can leave where the worktree should be: a directory git never finished, or a
// registration whose directory is gone. Either makes `worktree add` refuse.
const clearStaleCheckout = async (
  runGit: RunGit,
  repo: WorktreeRepo,
  path: string,
): Promise<void> => {
  await rm(path, { recursive: true, force: true });
  await runGit(["worktree", "prune"], repo.path);
};

const removeCheckout = async (runGit: RunGit, repo: WorktreeRepo, path: string): Promise<void> => {
  const removed = await runGit(["worktree", "remove", "--force", path], repo.path);
  if (removed.exitCode === 0) return;
  // Locked, or not a working tree at all: the directory is this thread's own, so clear it anyway.
  logger.warn("git worktree remove failed for {path}, deleting the directory: {error}", {
    path,
    error: removed.stderr.trim(),
  });
  await rm(path, { recursive: true, force: true });
};

const deleteRemoteBranch = async (runGit: RunGit, repoPath: string, branch: string) => {
  const deleted = await runGit(["push", "origin", "--delete", branch], repoPath);
  if (deleted.exitCode !== 0) {
    logger.info("Branch {branch} was not deleted on origin: {error}", {
      branch,
      error: deleted.stderr.trim(),
    });
  }
};

const branchExists = async (runGit: RunGit, repoPath: string, branch: string): Promise<boolean> =>
  (await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repoPath))
    .exitCode === 0;

// git-manager keeps a small record beside each worktree; without the worktree it is litter.
const forgetMetadata = (repoId: string, threadId: string): Promise<void> =>
  rm(`${aopPaths.worktreeMetadata(repoId)}/${threadId}.json`, { force: true });
