import type { LocalServerContext } from "../context.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { prepareFreshRetry } from "./fresh-retry.ts";
import { acceptMidRunMessage } from "./mid-run.ts";
import { isChatMidRunMode } from "./mid-run-mode.ts";
import { prepareSend } from "./prepare-send.ts";
import { completeAssistantReplyInBackground } from "./reply-lifecycle.ts";
import {
  abortRequestedSessions,
  pendingSessionReplies,
  trackBackgroundReply,
} from "./reply-state.ts";
import { registerPendingSessionRun, releaseSessionRunRegistration } from "./runtime-engine.ts";
import { sessionDtoFor, toMessageDto } from "./session-dto.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import type {
  ChatSessionServiceDeps,
  RetryFreshChatRunResult,
  SendChatMessageInput,
  SendChatMessageResult,
} from "./session-types.ts";
import { isChatSessionBusy } from "./steer-queue.ts";
import { acceptThreadMessage } from "./thread-send.ts";

export const sendChatMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  if (input.midRunMode !== undefined && !isChatMidRunMode(input.midRunMode)) {
    return { success: false, error: { code: "INVALID_MID_RUN_MODE" } };
  }
  ctx.sessionMutationLock.assertAllowed("send", { sessionId });
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (session?.kind === "thread") {
    return acceptThreadMessage(ctx, runtimeConfigurations, session, input, deps);
  }
  // Mid-run: accept the user message now (queue or interrupt+steer per setting).
  if (await isChatSessionBusy(ctx, sessionId, pendingSessionReplies)) {
    return acceptMidRunMessage(ctx, sessionId, input, deps);
  }
  return acceptIdleSessionMessage(ctx, runtimeConfigurations, sessionId, input, deps);
};

const acceptIdleSessionMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  const existing = await ctx.chatSessionRepository.getById(sessionId);
  if (!existing) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  // Register lifecycle ownership before durable insert/background so abort/steer
  // can cancel pending work without falling back to "no conversation".
  const registration = registerPendingSessionRun(sessionId, existing.runtime);
  if (!registration) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }

  let transferredRegistration = false;
  try {
    const prepared = await prepareSend(ctx, runtimeConfigurations, sessionId, input);
    if (!prepared.success) return prepared;

    pendingSessionReplies.add(sessionId);

    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: prepared.session,
        displayText: prepared.displayText,
        runtimePrompt: prepared.runtimePrompt,
        images: prepared.images,
        documents: prepared.documents,
        run: prepared.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
      }),
    );
    transferredRegistration = true;
    // Accept immediately; finish the assistant reply in the background so multi-minute
    // Multi-minute runs must not hit Bun.serve idleTimeout (502 / request failed).
    const sessionDto = await sessionDtoFor(
      ctx,
      prepared.session,
      prepared.displayText || "(image attachment)",
      prepared.userMessage.created_at,
    );
    publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
    return {
      success: true,
      message: toMessageDto(prepared.userMessage, prepared.run),
      session: sessionDto,
    };
  } finally {
    if (!transferredRegistration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};

export const retryFreshChatRun = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
  sessionId: string,
  runId: string,
  confirmed: unknown,
): Promise<RetryFreshChatRunResult> => {
  if (confirmed !== true) {
    return { success: false, error: { code: "CONFIRMATION_REQUIRED" } };
  }
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const registration = registerPendingSessionRun(sessionId, session.runtime);
  if (!registration) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }

  let transferredRegistration = false;
  try {
    const prepared = await prepareFreshRetry(ctx, sessionId, runId, confirmed);
    if (!prepared.success) return prepared;
    if (prepared.existing) {
      return {
        success: true,
        message: toMessageDto(prepared.message, prepared.run),
        session: await sessionDtoFor(ctx, prepared.session),
        existing: true,
      };
    }

    pendingSessionReplies.add(sessionId);
    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: prepared.session,
        displayText: prepared.displayText,
        runtimePrompt: prepared.runtimePrompt,
        images: prepared.images,
        documents: prepared.documents,
        run: prepared.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
      }),
    );
    transferredRegistration = true;
    return {
      success: true,
      message: toMessageDto(prepared.message, prepared.run),
      session: await sessionDtoFor(ctx, prepared.session),
      existing: false,
    };
  } finally {
    if (!transferredRegistration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};
