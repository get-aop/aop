import type { ChatActionPayload } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { createUsageService } from "../usage/service.ts";
import type { StoredChatArtifact } from "./message-images.ts";
import { isDbClosedError } from "./reply-state.ts";
import { type FinalizeChatRunOutcome, persistFinalizedChatRun } from "./run-finalization.ts";
import { sessionDtoFor, toMessageDto } from "./session-dto.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import type { AssistantActivity } from "./session-types.ts";

const logger = getLogger("chat-session", "finalize");

/**
 * Stores the run's terminal state and assistant message, lets the project domain react in the
 * same transaction, then publishes the change. Returns the sessions that now have a queued
 * message to start (a coordinator woken by a thread's report); the caller starts them, since
 * only it holds the provider dependencies.
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
  activity: AssistantActivity | null = null,
  artifacts: StoredChatArtifact[] = [],
): Promise<string[]> => {
  const persist = (withHooks: boolean) =>
    ctx.eventPublisher.transaction(async (tx) => {
      const assistantMessage = await persistFinalizedChatRun(
        tx.db,
        run,
        text,
        action,
        runtimeSessionId,
        outcome,
        activity,
        artifacts,
      );
      if (!assistantMessage) return null;
      const followUp = withHooks
        ? await ctx.sessionHooks.onRunFinalized(tx, { run, outcome, assistantMessage })
        : { wakeSessionIds: [] };
      return { finalized: assistantMessage, wakeSessionIds: followUp.wakeSessionIds };
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
  if (!done) return [];
  const { finalized, wakeSessionIds } = done;
  // Before the client hears the run is over, so a usage read after `assistant-final` sees it.
  await createUsageService(ctx.db).recordRunUsage(run);

  const session = await ctx.chatSessionRepository.getById(run.session_id);
  if (!session) return wakeSessionIds;
  const sessionDto = await sessionDtoFor(ctx, session, finalized.content, finalized.created_at);
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId: run.session_id,
    sessionTitle: session.title,
    message: toMessageDto(
      finalized,
      await ctx.db.selectFrom("chat_runs").selectAll().where("id", "=", run.id).executeTakeFirst(),
    ),
  });
  publishChatSessionEvent({
    type: "session-updated",
    sessionId: run.session_id,
    session: sessionDto,
  });
  return wakeSessionIds;
};
