import type { LocalServerContext } from "../context.ts";
import { finalizeChatRunAndPublish } from "./finalize-publish.ts";
import { drainQueuedSteers } from "./reply-lifecycle.ts";
import {
  abortRequestedSessions,
  backgroundReplyTasks,
  cancelChatRunRecovery,
  pendingSessionReplies,
  recoveryAbortControllers,
  recoveryTasks,
  waitForPendingChatReplies,
} from "./reply-state.ts";
import { stopOrphanedChatRunProcess } from "./run-process.ts";
import { activeSessionRunIds, interruptSessionRun } from "./runtime-engine.ts";
import { sessionDtoFor } from "./session-dto.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import type {
  AbortChatSessionResult,
  ChatSessionServiceDeps,
  ResetRuntimeSessionResult,
} from "./session-types.ts";
import { cancelQueuedSteers } from "./steer-queue.ts";

export const abortChatSession = async (
  ctx: LocalServerContext,
  sessionId: string,
  deps: ChatSessionServiceDeps,
): Promise<AbortChatSessionResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  // Stop ends the current reply only. Queued follow-ups survive so the drain
  // starts the next one — stopping steers the conversation, it does not purge
  // messages the user already committed to sending.
  const liveRunAborted = interruptSessionRun(sessionId, "abort");
  const pendingAccepted = pendingSessionReplies.has(sessionId);
  if (liveRunAborted || pendingAccepted) {
    abortRequestedSessions.add(sessionId);
    return { success: true, aborted: true, disposition: "interrupt_requested" };
  }

  const orphanedRun = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  if (!orphanedRun) return { success: true, aborted: false, disposition: "none" };

  // No live handle (the server restarted): stop the recorded CLI, then cancel the run.
  await cancelChatRunRecovery(orphanedRun.id);
  await stopOrphanedChatRunProcess(orphanedRun, session.runtime_alias);
  await finalizeChatRunAndPublish(
    ctx,
    orphanedRun,
    "Stopped after the app restarted.",
    null,
    orphanedRun.runtime_session_id ?? session.runtime_session_id,
    { status: "cancelled", interruptionKind: "abort", errorMessage: null },
  );
  // No in-flight reply will reach its drain, so start the queue here instead.
  await drainQueuedSteers(ctx, sessionId, session.runtime, deps);
  return { success: true, aborted: true, disposition: "durable_cancelled" };
};

export const resetRuntimeSession = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ResetRuntimeSessionResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const hadBinding = Boolean(session.runtime_session_id);
  const liveRunAborted = interruptSessionRun(sessionId, "reset");
  if (liveRunAborted) abortRequestedSessions.add(sessionId);
  await cancelQueuedSteers(ctx, sessionId, session.runtime, "reset");

  const runningRun = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();

  let cancelledRun = false;
  if (runningRun) {
    // Claim cancellation + clear binding so normal completion cannot write it back.
    await cancelChatRunRecovery(runningRun.id);
    await finalizeChatRunAndPublish(
      ctx,
      runningRun,
      "Runtime session reset. The next message will start a fresh runtime session.",
      null,
      null,
      {
        status: "cancelled",
        errorMessage: null,
        failureKind: null,
        interruptionKind: "reset",
        bindingPolicy: "clear",
      },
    );
    cancelledRun = true;
  }

  await ensureRuntimeBindingCleared(ctx, sessionId);

  return {
    success: true,
    reset: true,
    clearedBinding: hadBinding || cancelledRun,
    cancelledRun: cancelledRun || liveRunAborted,
  };
};

const ensureRuntimeBindingCleared = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const latest = await ctx.chatSessionRepository.getById(sessionId);
  if (!latest?.runtime_session_id) return;
  const now = new Date().toISOString();
  await ctx.db
    .updateTable("chat_sessions")
    .set({ runtime_session_id: null, updated_at: now })
    .where("id", "=", sessionId)
    .execute();
  const updated = await ctx.chatSessionRepository.getById(sessionId);
  if (!updated) return;
  const sessionDto = await sessionDtoFor(ctx, updated, null, now);
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
};

/** Stop current-process chat work before the local server releases its database. */
export const shutdownChatSessions = async (ctx: LocalServerContext): Promise<void> => {
  for (const controller of recoveryAbortControllers.values()) controller.abort();
  const sessionIds = new Set([...activeSessionRunIds(), ...pendingSessionReplies]);
  for (const sessionId of sessionIds) {
    abortRequestedSessions.add(sessionId);
    interruptSessionRun(sessionId, "abort");
    const session = await ctx.chatSessionRepository.getById(sessionId);
    if (session) await cancelQueuedSteers(ctx, sessionId, session.runtime, "abort");
  }
  while (backgroundReplyTasks.size > 0) {
    await Promise.allSettled(backgroundReplyTasks);
  }
  await Promise.allSettled(recoveryTasks.values());
};

/**
 * Force-stop chat runtimes before a hard repo purge.
 * Interrupts live processes, cancels queued steers, waits for background finalizers,
 * then cancels any still-running durable rows so no provider keeps working on a gone repo.
 */
export const forceAbortChatSessionsForPurge = async (
  ctx: LocalServerContext,
  sessionIds: string[],
): Promise<void> => {
  if (sessionIds.length === 0) return;
  for (const sessionId of sessionIds) {
    await interruptChatSessionForPurge(ctx, sessionId);
  }
  await waitForPendingChatReplies();
  for (const sessionId of sessionIds) {
    await cancelOrphanedChatRunsForPurge(ctx, sessionId);
  }
};

const interruptChatSessionForPurge = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return;
  if (interruptSessionRun(sessionId, "abort")) {
    abortRequestedSessions.add(sessionId);
  }
  await cancelQueuedSteers(ctx, sessionId, session.runtime, "abort");
};

const cancelOrphanedChatRunsForPurge = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const orphanedRuns = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .execute();
  const executable = (await ctx.chatSessionRepository.getById(sessionId))?.runtime_alias ?? null;
  for (const orphanedRun of orphanedRuns) {
    await cancelChatRunRecovery(orphanedRun.id);
    await stopOrphanedChatRunProcess(orphanedRun, executable);
    await finalizeChatRunAndPublish(
      ctx,
      orphanedRun,
      "Stopped because the repository was unregistered.",
      null,
      null,
      {
        status: "cancelled",
        interruptionKind: "abort",
        errorMessage: null,
        bindingPolicy: "clear",
      },
    );
  }
};
