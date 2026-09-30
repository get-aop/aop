import type { SessionDiffFile, SessionGitDiff } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { getSessionGitDiffFile, getSessionGitDiffSummary } from "../session-git/diff.ts";
import { defaultRunGit, type RunGit } from "../session-git/service.ts";
import type { ThreadError, ThreadResult } from "./types.ts";

/**
 * What a thread changed in its worktree, against where its branch left the default branch:
 * committed, uncommitted and untracked files alike, so it reads the same before and after the
 * thread opened its pull request. Read-only: it never creates or removes a worktree, so a thread
 * whose worktree was released (resolved, or merged) answers `WORKTREE_FAILED` instead of getting
 * an empty checkout made for it.
 */
export interface ThreadChanges {
  /** The changed files and their line counts, without hunks: cheap however large the change. */
  changes: (threadId: string) => Promise<ThreadResult<{ diff: SessionGitDiff }>>;
  /** One file's hunks, capped, for a row the person expanded. `path` is relative to the worktree. */
  changedFile: (threadId: string, path: string) => Promise<ThreadResult<{ file: SessionDiffFile }>>;
}

export const createThreadChanges = (
  ctx: LocalServerContext,
  deps: { runGit?: RunGit } = {},
): ThreadChanges => {
  const runGit = deps.runGit ?? defaultRunGit;

  return {
    changes: async (threadId) => {
      const refused = await refusal(ctx, threadId);
      if (refused) return { success: false, error: refused };
      const result = await getSessionGitDiffSummary(ctx, threadId, runGit);
      return result.success
        ? { success: true, diff: result.diff }
        : { success: false, error: diffError(result.error) };
    },

    changedFile: async (threadId, path) => {
      const refused = await refusal(ctx, threadId);
      if (refused) return { success: false, error: refused };
      const result = await getSessionGitDiffFile(ctx, threadId, path, runGit);
      return result.success
        ? { success: true, file: result.file }
        : { success: false, error: diffError(result.error) };
    },
  };
};

// A coordinator or plain session shares an id space with threads and is not one; a thread with no
// repository has no branch to compare.
const refusal = async (ctx: LocalServerContext, threadId: string): Promise<ThreadError | null> => {
  const thread = await ctx.threadRepository.getById(threadId);
  if (!thread) return { code: "THREAD_NOT_FOUND" };
  return thread.repoId ? null : { code: "NO_REPOSITORY" };
};

const diffError = (
  error:
    | { code: "SESSION_NOT_FOUND" }
    | { code: "WORKSPACE_BINDING_ERROR"; message: string }
    | { code: "PATH_REQUIRED" }
    | { code: "FILE_NOT_FOUND" },
): ThreadError => {
  switch (error.code) {
    case "SESSION_NOT_FOUND":
      return { code: "THREAD_NOT_FOUND" };
    case "WORKSPACE_BINDING_ERROR":
      return { code: "WORKTREE_FAILED", message: error.message };
    case "PATH_REQUIRED":
      return { code: "INVALID_PATH" };
    case "FILE_NOT_FOUND":
      return { code: "FILE_NOT_FOUND" };
  }
};
