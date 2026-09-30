import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatSession } from "../db/schema.ts";
import { executeChatCommand } from "./commands.ts";
import { drainQueuedSteers } from "./reply-lifecycle.ts";
import { createSessionRunLogPath } from "./runtime-engine.ts";
import { sessionDtoFor, toMessageDto } from "./session-dto.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import type {
  ChatSessionServiceDeps,
  SendChatMessageInput,
  SendChatMessageResult,
} from "./session-types.ts";
import { storeSteerUserMessage } from "./steer-queue.ts";

export const acceptMidRunMessage = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  const stored = await storeValidatedMidRunMessage(ctx, sessionId, input, "queued");
  if (!stored.success) return stored;

  // Slash commands never wait on an LLM — execute immediately even mid-run.
  const immediate = await tryImmediateMidRunSlash(ctx, sessionId, stored);
  if (immediate) return immediate;

  const sessionDto = await sessionDtoFor(
    ctx,
    stored.session,
    stored.displayText || "(image attachment)",
    stored.userMessage.created_at,
  );
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });

  // Drain only if the active run already finished while this message was stored.
  void drainQueuedSteers(ctx, sessionId, stored.session.runtime, deps);

  return {
    success: true,
    message: toMessageDto(stored.userMessage),
    session: sessionDto,
    midRun: "queued",
    queued: true,
    steered: false,
  };
};

const storeValidatedMidRunMessage = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: SendChatMessageInput,
  disposition: "queued" | "steered",
) => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false as const, error: { code: "SESSION_NOT_FOUND" as const } };
  return storeSteerUserMessage(ctx, sessionId, { ...input, action: null }, disposition);
};

/**
 * Deterministic slash commands must not queue as LLM prompts. Claim the
 * user message with a completed run and publish the command reply immediately.
 */
const tryImmediateMidRunSlash = async (
  ctx: LocalServerContext,
  sessionId: string,
  stored: {
    session: ChatSession;
    userMessage: ChatMessage;
    displayText: string;
  },
): Promise<SendChatMessageResult | null> => {
  const text = stored.displayText.trim();
  if (!text.startsWith("/")) return null;

  const command = await executeChatCommand(ctx, stored.session, text || "(image attachment)");
  if (!command || command.forwardToRuntime) return null;

  let nextSession = stored.session;
  if (command.sessionPatch) {
    nextSession =
      (await ctx.chatSessionRepository.update(sessionId, {
        ...command.sessionPatch,
        updated_at: new Date().toISOString(),
      })) ?? stored.session;
  }

  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const now = new Date().toISOString();
  const logFilePath = await createSessionRunLogPath(sessionId);
  const turnIndex = stored.userMessage.turn_index;

  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .insertInto("chat_runs")
      .values({
        id: runId,
        session_id: sessionId,
        user_message_id: stored.userMessage.id,
        assistant_message_id: assistantMessageId,
        runtime: nextSession.runtime,
        log_file_path: logFilePath,
        status: "completed",
        runtime_session_id: nextSession.runtime_session_id,
        resume_session_id: nextSession.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: nextSession.runtime_session_id ? "native_resume" : "fresh",
        workspace_path: nextSession.workspace_path,
        timeout_policy: null,
        retry_of_run_id: null,
        runtime_session_state: nextSession.runtime_session_id ? "confirmed" : null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await trx
      .insertInto("chat_messages")
      .values({
        id: assistantMessageId,
        session_id: sessionId,
        role: "assistant",
        content: command.text,
        action: command.action ? JSON.stringify(command.action) : null,
        activity: null,
        turn_index: turnIndex,
        disposition: "immediate",
        created_at: now,
      })
      .execute();
  });

  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    session_id: sessionId,
    role: "assistant",
    content: command.text,
    action: command.action ? JSON.stringify(command.action) : null,
    activity: null,
    origin_json: null,
    turn_index: turnIndex,
    disposition: "immediate",
    created_at: now,
  };
  const sessionDto = await sessionDtoFor(ctx, nextSession, command.text, now);
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId,
    message: toMessageDto(assistantMessage),
  });
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });

  return {
    success: true,
    message: toMessageDto(stored.userMessage),
    session: sessionDto,
  };
};
