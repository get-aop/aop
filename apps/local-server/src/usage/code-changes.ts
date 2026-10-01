import type { CodeChanges } from "@aop/common";
import { mapLimit } from "@aop/infra";
import type { ThreadChanges } from "../thread/changes.ts";

/** Reads one thread's change at a time per slot: each read runs git in that thread's worktree. */
const CONCURRENT_READS = 4;

/**
 * The lines the threads changed, summed: each thread's worktree against where its branch left the
 * default branch, as the thread's changes panel shows it. A thread with no repository, or whose
 * worktree is gone (resolved, merged), adds nothing: its change is no longer on this machine.
 */
export const sumThreadChanges = async (
  changes: Pick<ThreadChanges, "changes">,
  threadIds: readonly string[],
): Promise<CodeChanges> => {
  const perThread = await mapLimit(threadIds, CONCURRENT_READS, async (threadId) => {
    const result = await changes.changes(threadId);
    return result.success ? result.diff.files : [];
  });
  let additions = 0;
  let deletions = 0;
  for (const file of perThread.flat()) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
};
