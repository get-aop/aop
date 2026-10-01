import type { ChatActionPayload, TurnPart } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { createUsageService } from "../usage/service.ts";
import type { StoredChatArtifact } from "./message-images.ts";
import { isDbClosedError } from "./reply-state.ts";
import { type FinalizeChatRunOutcome, persistFinalizedChatRun } from "./run-finalization.ts";
import { releaseUntakenSteers } from "./run-input.ts";
import type { TurnFollowUp } from "./session-hooks.ts";

const logger = getLogger("chat-session", "finalize");

/**
 * Stores the run's terminal state and assistant message, puts back in line what was sent to the
 * run as it worked and never reached it, lets the project domain react in the same transaction,
 * then publishes the change. Returns what the turn leaves to do: the sessions
 * that now have a queued message to start (a coordinator woken by a thread's report) and a
 * session that waits out a rate limit and must be resumed. The caller does both, since only it
 * holds the provider dependencies.
 */
export const finalizeChatRunAndPublish = async (
  ctx: LocalServerContext,
  run: ChatRun,
  text: string,
  action: ChatActionPayload | null,
  runtimeSessionId: string | null,
  outcome: FinalizeChatRunOutcome = {
    status: "completed",
    errorMessage: null,
  },
  parts: readonly TurnPart[] | null = null,
  artifacts: StoredChatArtifact[] = [],
): Promise<TurnFollowUp> => {
  const persist = (withHooks: boolean) =>
    ctx.eventPublisher.transaction(async (tx) => {
      const assistantMessage = await persistFinalizedChatRun(
        tx.db,
        run,
        text,
        action,
        runtimeSessionId,
        outcome,
        parts,
        artifacts,
      );
      if (!assistantMessage) return null;
      await releaseUntakenSteers(tx, ctx, run, {
        stopped: outcome.status === "cancelled",
        notify: withHooks,
      });
      const followUp = withHooks
        ? await ctx.sessionHooks.onRunFinalized(tx, { run, outcome, assistantMessage })
        : NO_FOLLOW_UP;
      return { finalized: assistantMessage, followUp };
    });
  const done = await persist(true).catch(async (error: unknown) => {
    if (isDbClosedError(error)) throw error;
    // What reacts to a run must not leave the run unfinished: its process is gone, and recovery
    // would meet the same failure on every start.
    logger.error("The project hooks failed for run {runId}; finalizing without them: {error}", {
      runId: run.id,
      error: String(error),
    });
    return persist(false);
  });
  if (!done) return NO_FOLLOW_UP;
  await createUsageService(ctx.db).recordRunUsage(run);
  return done.followUp;
};

export const NO_FOLLOW_UP: TurnFollowUp = { wakeSessionIds: [], resume: null };
