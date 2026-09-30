import type { Thread, ThreadStatus } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository, type ThreadPatch } from "./repository.ts";

/** Changes a thread and appends its `thread.upserted` entry in one transaction; returns the thread as it now is. */
export const changeThread = async (
  ctx: LocalServerContext,
  threadId: string,
  patch: ThreadPatch,
): Promise<Thread | null> => {
  await ctx.eventPublisher.transaction(async (tx) => {
    await createThreadRepository(tx.db).update(threadId, patch);
    await recordThreadUpserted(tx, threadId);
  });
  return ctx.threadRepository.getById(threadId);
};

/**
 * Like `changeThread`, but the status in the patch applies only if the thread is in one of
 * `from` when the change is made, which is read in the same transaction: a status chosen from an
 * earlier read never overwrites a newer one. The rest of the patch applies either way. `previous`
 * is the thread as that transaction found it.
 */
export const changeThreadFrom = async (
  ctx: LocalServerContext,
  threadId: string,
  from: readonly ThreadStatus[],
  patch: ThreadPatch,
): Promise<{ thread: Thread | null; previous: Thread | null; applied: boolean }> => {
  const outcome = await ctx.eventPublisher.transaction(async (tx) => {
    const threads = createThreadRepository(tx.db);
    const previous = await threads.getById(threadId);
    if (!previous) return { previous, applied: false };
    const applied = patch.status === undefined || from.includes(previous.status);
    const { status: _status, ...rest } = patch;
    await threads.update(threadId, applied ? patch : rest);
    await recordThreadUpserted(tx, threadId);
    return { previous, applied };
  });
  return { ...outcome, thread: await ctx.threadRepository.getById(threadId) };
};
