import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { finalizeChatRunAndPublish, NO_FOLLOW_UP } from "./finalize-publish.ts";
import { createSessionRunLogPath } from "./runtime-engine.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "./runtime-timeout-policy.ts";
import type { TurnFollowUp } from "./session-hooks.ts";
import { loadOldestQueuedMessage, persistQueuedRun } from "./steer-queue.ts";

/**
 * Ends a session's oldest queued turn as failed, with `reason` as its reply, because it cannot
 * start (its workspace is gone). Left queued, it would be tried again by every pass over the
 * queue and never run, with nothing to tell the person; failed, it is over and says why.
 */
export const failUnstartableTurn = async (
  ctx: LocalServerContext,
  sessionId: string,
  reason: string,
): Promise<TurnFollowUp> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  const queued = await loadOldestQueuedMessage(ctx, sessionId);
  if (!session || !queued) return NO_FOLLOW_UP;

  const claimed = await persistQueuedRun(ctx, {
    session,
    queued,
    sessionId,
    runId: generateTypeId("crun"),
    assistantMessageId: generateTypeId("smsg"),
    logFilePath: await createSessionRunLogPath(sessionId),
    contextStrategy: "fresh",
    workspacePath: null,
    timeoutPolicy: CHAT_RUNTIME_TIMEOUT_POLICY.policyName,
    // It takes no slot: the run below ends before this function returns.
    runCap: null,
  });
  if (typeof claimed === "string") return NO_FOLLOW_UP;
  return finalizeChatRunAndPublish(
    ctx,
    claimed.run,
    `This turn could not start: ${reason}`,
    null,
    session.runtime_session_id,
    { status: "failed", errorMessage: reason },
  );
};
