import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { produceAssistantReply } from "./assistant-reply.ts";
import { finalizeChatRunAndPublish, NO_FOLLOW_UP } from "./finalize-publish.ts";
import type { StoredChatDocument, StoredChatImage } from "./message-images.ts";
import { armResume, type DrainSession, pausedReply } from "./rate-limit-resume.ts";
import {
  abortRequestedSessions,
  isDbClosedError,
  pendingSessionReplies,
  shouldSkipAssistantReply,
  trackBackgroundReply,
} from "./reply-state.ts";
import {
  COORDINATOR_WAKE_WINDOW_MS,
  isThreadReport,
  scheduleCoordinatorWake,
} from "./report-batch.ts";
import { dispatchQueuedThreadTurns, isStopping, type StartOutcome } from "./run-dispatch.ts";
import {
  type CreateProviderFn,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  type SessionRunRegistration,
} from "./runtime-engine.ts";
import type { TurnFollowUp } from "./session-hooks.ts";
import type { ChatSessionServiceDeps } from "./session-types.ts";
import { claimNextQueuedSteer, loadOldestQueuedMessage } from "./steer-queue.ts";
import { failUnstartableTurn } from "./unstartable-turn.ts";

/**
 * Starts the next queued message of a session that has gone idle. A thread's turn waits for a
 * free run slot in line with every other thread's, so it goes through the dispatcher, which may
 * start another thread's turn first. A coordinator whose next message is a thread report waits a
 * short quiet window first, so reports that arrive together are answered by one run
 * (report-batch.ts); any other session starts its own at once.
 */
export const drainQueuedSteers = async (
  ctx: LocalServerContext,
  sessionId: string,
  runtime: string,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  try {
    const kind = (await ctx.chatSessionRepository.getById(sessionId))?.kind;
    if (kind === "thread") {
      await dispatchQueuedRuns(ctx, deps);
    } else if (kind === "coordinator" && (await nextIsThreadReport(ctx, sessionId))) {
      scheduleCoordinatorWake(
        sessionId,
        deps.coordinatorWakeWindowMs ?? COORDINATOR_WAKE_WINDOW_MS,
        async () => void (await startQueuedTurn(ctx, sessionId, runtime, deps)),
      );
    } else {
      await startQueuedTurn(ctx, sessionId, runtime, deps);
    }
  } catch (error) {
    // Teardown / server stop can race with post-reply drain.
    if (isDbClosedError(error)) return;
    throw error;
  }
};

/** Starts every queued thread turn the host has room for. */
export const dispatchQueuedRuns = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  try {
    await dispatchQueuedThreadTurns(ctx, (sessionId, runtime) =>
      startQueuedTurn(ctx, sessionId, runtime, deps),
    );
  } catch (error) {
    if (isDbClosedError(error)) return;
    throw error;
  }
};

/** How a session's rate-limit wait ends: its next queued turn starts, the way any turn's follow-up does. */
export const drainAfterResume =
  (ctx: LocalServerContext, deps: ChatSessionServiceDeps): DrainSession =>
  (sessionId, runtime) =>
    drainQueuedSteers(ctx, sessionId, runtime, deps);

// A turn that got no run: the host is full, the session cannot take it now, or it can never start.
const notStarted = async (
  ctx: LocalServerContext,
  sessionId: string,
  claim: Extract<Awaited<ReturnType<typeof claimNextQueuedSteer>>, { success: false }>,
  deps: ChatSessionServiceDeps,
): Promise<StartOutcome> => {
  if (claim.reason === "FULL") return "full";
  if (claim.reason !== "UNSTARTABLE") return "skipped";
  await applyFollowUp(ctx, await failUnstartableTurn(ctx, sessionId, claim.message), deps);
  return "failed";
};

const startQueuedTurn = async (
  ctx: LocalServerContext,
  sessionId: string,
  runtime: string,
  deps: ChatSessionServiceDeps,
): Promise<StartOutcome> => {
  let registration: SessionRunRegistration | null = null;
  try {
    if (abortRequestedSessions.has(sessionId) || isStopping(ctx)) return "skipped";
    registration = registerPendingSessionRun(sessionId, runtime);
    if (!registration) return "skipped";
    await deps.beforeQueuedRunClaim?.(sessionId);
    const claimed = await claimNextQueuedSteer(ctx, sessionId, pendingSessionReplies, registration);
    if (!claimed.success) return notStarted(ctx, sessionId, claimed, deps);
    pendingSessionReplies.add(sessionId);
    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: claimed.session,
        displayText: claimed.displayText,
        runtimePrompt: claimed.runtimePrompt,
        images: claimed.images,
        documents: claimed.documents,
        run: claimed.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
        coordinatorWakeWindowMs: deps.coordinatorWakeWindowMs,
      }),
    );
    registration = null;
    return "started";
  } catch (error) {
    // Teardown / server stop can race with post-reply drain.
    if (isDbClosedError(error)) return "skipped";
    throw error;
  } finally {
    if (registration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};

export const completeAssistantReplyInBackground = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  displayText: string;
  runtimePrompt: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  run: ChatRun;
  registration: SessionRunRegistration;
  createProviderFn?: CreateProviderFn;
  beforeAssistantReply?: (run: ChatRun) => Promise<void>;
  beforeQueuedRunClaim?: (sessionId: string) => Promise<void>;
  coordinatorWakeWindowMs?: number;
}): Promise<void> => {
  let followUp: TurnFollowUp = NO_FOLLOW_UP;
  try {
    await input.beforeAssistantReply?.(input.run);
    if (await shouldSkipAssistantReply(input.ctx, input.sessionId, input.run.id)) {
      await finalizeSuppressedReply(input);
      return;
    }
    followUp = await runAndPublishAssistantReply(input);
  } catch (error) {
    if (isDbClosedError(error)) return;
    await publishReplyFailure(input, error);
  } finally {
    releaseSessionRunRegistration(input.registration);
    pendingSessionReplies.delete(input.sessionId);
    // Clear the abort flag first: it suppresses the turn the user stopped, not the
    // queue behind it. Shutdown and runtime reset cancel their queues explicitly,
    // so this drain finds nothing to start for them.
    abortRequestedSessions.delete(input.sessionId);
    // Auto-start the next mid-run steer message, if any. Await claim+track so
    // waitForPendingChatReplies still sees the follow-up background task.
    const deps = {
      createProviderFn: input.createProviderFn,
      beforeQueuedRunClaim: input.beforeQueuedRunClaim,
      coordinatorWakeWindowMs: input.coordinatorWakeWindowMs,
    };
    await drainQueuedSteers(input.ctx, input.sessionId, input.session.runtime, deps);
    await applyFollowUp(input.ctx, followUp, deps);
  }
};

const nextIsThreadReport = async (ctx: LocalServerContext, sessionId: string): Promise<boolean> => {
  const next = await loadOldestQueuedMessage(ctx, sessionId);
  return next !== undefined && isThreadReport(next);
};

/**
 * Does what a finished turn left to do: arms the resume timer of a session it put on hold, and
 * starts the queued message of sessions it wrote to (a coordinator's inbox).
 */
export const applyFollowUp = async (
  ctx: LocalServerContext,
  followUp: TurnFollowUp,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  if (followUp.resume) {
    armResume(ctx, followUp.resume.sessionId, followUp.resume.at, drainAfterResume(ctx, deps));
  }
  for (const sessionId of followUp.wakeSessionIds) {
    const session = await ctx.chatSessionRepository.getById(sessionId);
    if (session) await drainQueuedSteers(ctx, sessionId, session.runtime, deps);
  }
};

const finalizeSuppressedReply = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  run: ChatRun;
}): Promise<void> => {
  const current = await input.ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", input.run.id)
    .executeTakeFirst();
  if (current?.status !== "running") return;
  await finalizeChatRunAndPublish(
    input.ctx,
    current,
    "Conversation stopped.",
    null,
    input.session.runtime_session_id,
    { status: "cancelled", interruptionKind: "abort", errorMessage: null },
  );
};

const runAndPublishAssistantReply = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  displayText: string;
  runtimePrompt: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  run: ChatRun;
  registration: SessionRunRegistration;
  createProviderFn?: CreateProviderFn;
}): Promise<TurnFollowUp> => {
  const produced = await produceAssistantReply(
    input.ctx,
    input.session,
    input.run.user_message_id,
    input.displayText,
    input.runtimePrompt,
    input.images,
    input.documents,
    input.run.log_file_path,
    input.createProviderFn,
    input.run,
    input.registration,
  );
  const paused = await pausedReply(input.ctx.db, input.session, produced.text, produced.rateLimit);
  const reply = { ...produced, text: paused.text, rateLimit: paused.rateLimit };
  return finalizeChatRunAndPublish(
    input.ctx,
    input.run,
    reply.text,
    reply.action,
    reply.runtimeSessionId,
    reply.interrupted
      ? reply.aborted
        ? {
            status: "cancelled",
            interruptionKind: reply.interruptionKind ?? "abort",
            errorMessage: null,
            failureKind: null,
            runtimeSessionState: reply.runtimeSessionState,
          }
        : {
            status: "interrupted",
            interruptionKind: "steer",
            errorMessage: null,
            failureKind: null,
            runtimeSessionState: reply.runtimeSessionState,
          }
      : reply.failed
        ? {
            status: "failed",
            errorMessage: reply.text,
            failureKind: reply.failureKind ?? null,
            runtimeSessionState: reply.runtimeSessionState,
            rateLimit: reply.rateLimit,
          }
        : undefined,
    reply.parts,
    reply.artifacts ?? [],
  );
};

const publishReplyFailure = async (
  input: {
    ctx: LocalServerContext;
    sessionId: string;
    session: ChatSession;
    run: ChatRun;
  },
  error: unknown,
): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await finalizeChatRunAndPublish(
      input.ctx,
      input.run,
      `Runtime error: ${message}`,
      null,
      input.session.runtime_session_id,
      { status: "failed", errorMessage: message },
    );
  } catch (persistError) {
    if (!isDbClosedError(persistError)) throw persistError;
  }
};
