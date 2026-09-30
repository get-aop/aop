import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { produceAssistantReply } from "./assistant-reply.ts";
import { finalizeChatRunAndPublish } from "./finalize-publish.ts";
import type { StoredChatDocument, StoredChatImage } from "./message-images.ts";
import {
  abortRequestedSessions,
  isDbClosedError,
  pendingSessionReplies,
  shouldSkipAssistantReply,
  trackBackgroundReply,
} from "./reply-state.ts";
import {
  type CreateProviderFn,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  type SessionRunRegistration,
} from "./runtime-engine.ts";
import type { ChatSessionServiceDeps } from "./session-types.ts";
import { claimNextQueuedSteer } from "./steer-queue.ts";

export const drainQueuedSteers = async (
  ctx: LocalServerContext,
  sessionId: string,
  runtime: string,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  let registration: SessionRunRegistration | null = null;
  try {
    if (abortRequestedSessions.has(sessionId)) return;
    registration = registerPendingSessionRun(sessionId, runtime);
    if (!registration) return;
    await deps.beforeQueuedRunClaim?.(sessionId);
    const claimed = await claimNextQueuedSteer(ctx, sessionId, pendingSessionReplies, registration);
    if (!claimed.success) return;
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
      }),
    );
    registration = null;
  } catch (error) {
    // Teardown / server stop can race with post-reply drain.
    if (isDbClosedError(error)) return;
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
}): Promise<void> => {
  let wakeSessionIds: string[] = [];
  try {
    await input.beforeAssistantReply?.(input.run);
    if (await shouldSkipAssistantReply(input.ctx, input.sessionId, input.run.id)) {
      await finalizeSuppressedReply(input);
      return;
    }
    wakeSessionIds = await runAndPublishAssistantReply(input);
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
    };
    await drainQueuedSteers(input.ctx, input.sessionId, input.session.runtime, deps);
    await wakeSessions(input.ctx, wakeSessionIds, deps);
  }
};

/** Starts the next queued message of sessions another session's turn just wrote to (a coordinator's inbox). */
export const wakeSessions = async (
  ctx: LocalServerContext,
  sessionIds: readonly string[],
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  for (const sessionId of sessionIds) {
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
}): Promise<string[]> => {
  const reply = await produceAssistantReply(
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
          }
        : undefined,
    reply.activity,
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
