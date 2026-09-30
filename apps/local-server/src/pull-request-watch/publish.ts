import type { PullRequestChecks } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { pullRequestOf } from "../thread/state.ts";
import { sameChecks } from "./check-runs.ts";

/**
 * Puts what the checks add up to on the thread's `pr` artifact and tells the project's stream,
 * in one transaction. Only the checks are written, and only while the thread still has this pull
 * request open: a merge or a close that landed since the poll began is not undone by it. Returns
 * whether anything changed, so a summary that reads the same twice is announced once.
 */
export const publishChecks = async (
  ctx: LocalServerContext,
  threadId: string,
  pullRequestNumber: number,
  checks: PullRequestChecks | null,
): Promise<boolean> =>
  ctx.eventPublisher.transaction(async (tx) => {
    const threads = createThreadRepository(tx.db);
    const thread = await threads.getById(threadId);
    const recorded = thread && pullRequestOf(thread);
    if (!recorded || recorded.number !== pullRequestNumber || recorded.state !== "open")
      return false;
    if (sameChecks(recorded.checks, checks)) return false;
    await threads.update(threadId, { checks });
    await recordThreadUpserted(tx, threadId);
    return true;
  });
