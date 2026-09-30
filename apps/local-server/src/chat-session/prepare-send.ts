import type { ChatActionPayload, ChatDocumentAttachment, ChatImageAttachment } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatContextStrategy, ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import { loadTurnContext } from "../project/prompt-context.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { prepareConversationPrompt } from "./conversation-history.ts";
import {
  buildRuntimePrompt,
  encodeMessageContent,
  loadChatGlobalInstructions,
  materializeChatDocuments,
  materializeChatImages,
  type StoredChatDocument,
  type StoredChatImage,
  type StoredChatPaste,
  validateChatDocumentAttachments,
  validateChatImageAttachments,
  validateChatPastes,
} from "./message-images.ts";
import { type MessageOrigin, serializeMessageOrigin } from "./message-origin.ts";
import { pendingSessionReplies } from "./reply-state.ts";
import { resolveRuntimeConfigurationPatch } from "./runtime-configuration-patch.ts";
import { createSessionRunLogPath } from "./runtime-engine.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "./runtime-timeout-policy.ts";
import { deriveAutoTitle } from "./session-dto.ts";
import type { SendChatMessageInput, SendChatMessageResult } from "./session-types.ts";
import { nextChatTurnIndex } from "./turn-order.ts";
import { resolveSessionWorkspaceBinding } from "./workspace-binding.ts";

const isActiveChatRunConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("uq_chat_runs_running_session") ||
    message.includes("UNIQUE constraint failed: chat_runs.session_id")
  );
};

const validateSendContent = (
  input: SendChatMessageInput,
):
  | {
      success: true;
      text: string;
      images: ChatImageAttachment[];
      documents: ChatDocumentAttachment[];
      pastes: StoredChatPaste[];
    }
  | Extract<SendChatMessageResult, { success: false }> => {
  const text = typeof input.content === "string" ? input.content.trim() : "";
  const imagesResult = validateChatImageAttachments(input.imageAttachments);
  if (!imagesResult.success) {
    return {
      success: false,
      error: { code: "INVALID_IMAGES", message: imagesResult.error },
    };
  }
  const documentsResult = validateChatDocumentAttachments(input.documentAttachments);
  if (!documentsResult.success) {
    return {
      success: false,
      error: { code: "INVALID_DOCUMENTS", message: documentsResult.error },
    };
  }
  const pastesResult = validateChatPastes(input.pastes);
  if (!pastesResult.success) {
    return {
      success: false,
      error: { code: "INVALID_CONTENT", message: pastesResult.error },
    };
  }
  return text || imagesResult.images.length > 0 || documentsResult.documents.length > 0
    ? {
        success: true,
        text,
        images: imagesResult.images,
        documents: documentsResult.documents,
        pastes: pastesResult.pastes,
      }
    : { success: false, error: { code: "INVALID_CONTENT" } };
};

type PreparedSendResult =
  | {
      success: true;
      session: ChatSession;
      displayText: string;
      runtimePrompt: string;
      images: StoredChatImage[];
      documents: StoredChatDocument[];
      userMessage: ChatMessage;
      run: ChatRun;
    }
  | Extract<SendChatMessageResult, { success: false }>;

const resolvePreparedSendSession = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
): Promise<PreparedSendResult | { session: ChatSession }> => {
  const storedSession = await ctx.chatSessionRepository.getById(sessionId);
  if (!storedSession) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const resolved = await resolveCurrentSessionRuntimeConfiguration(
    ctx,
    runtimeConfigurations,
    storedSession,
  );
  if (!resolved.success) return resolved;
  return { session: resolved.session };
};

export const prepareSend = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
): Promise<PreparedSendResult> => {
  const resolved = await resolvePreparedSendSession(ctx, runtimeConfigurations, sessionId);
  if (!("session" in resolved)) return resolved;
  const session = resolved.session;

  const sendInput = validatePreparedSendInput(sessionId, input);
  if (!sendInput.success) return sendInput;

  return prepareRuntimeSend(ctx, session, sendInput, input.origin ?? null);
};

const prepareRuntimeSend = async (
  ctx: LocalServerContext,
  session: ChatSession,
  sendInput: Extract<Awaited<ReturnType<typeof validatePreparedSendInput>>, { success: true }>,
  origin: MessageOrigin | null,
): Promise<PreparedSendResult> => {
  const { text, images, documents, pastes, displayText } = sendInput;
  const sessionId = session.id;
  const messageId = generateTypeId("smsg");
  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const logFilePath = await createSessionRunLogPath(sessionId);
  const storedImages = await materializeChatImages(sessionId, messageId, images);
  const storedDocuments = await materializeChatDocuments(sessionId, messageId, documents);
  // Store compact tokens + paste bodies; API DTOs and runtime prompts expand.
  const storedContent = encodeMessageContent(text, storedImages, storedDocuments, [], pastes);
  const now = new Date().toISOString();
  const workspacePath = await resolveSessionWorkspaceBinding(ctx, session);
  if (!workspacePath) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const globalInstructions = await loadChatGlobalInstructions(ctx.settingsRepository);
  const turnContext = await loadTurnContext(ctx, session);
  const baseRuntimePrompt = buildRuntimePrompt(
    text,
    sessionId,
    storedImages,
    storedDocuments,
    pastes,
    globalInstructions,
    turnContext,
  );
  const context = await prepareConversationPrompt({
    ctx,
    session,
    currentUserMessageId: messageId,
    currentPrompt: baseRuntimePrompt,
  });

  let prepared: { session: ChatSession; userMessage: ChatMessage; run: ChatRun };
  try {
    prepared = await persistPreparedSend(ctx, {
      session,
      sessionId,
      messageId,
      assistantMessageId,
      runId,
      logFilePath,
      storedContent,
      displayText,
      workspacePath,
      contextStrategy: context.strategy,
      timeoutPolicy: CHAT_RUNTIME_TIMEOUT_POLICY.policyName,
      now,
      action: null,
      origin,
    });
  } catch (error) {
    if (isActiveChatRunConflict(error)) {
      return { success: false, error: { code: "RUN_IN_PROGRESS" } };
    }
    throw error;
  }

  return {
    success: true,
    session: prepared.session,
    displayText,
    runtimePrompt: context.prompt,
    images: storedImages,
    documents: storedDocuments,
    userMessage: prepared.userMessage,
    run: prepared.run,
  };
};

const validatePreparedSendInput = (
  sessionId: string,
  input: SendChatMessageInput,
):
  | {
      success: true;
      text: string;
      images: Parameters<typeof materializeChatImages>[2];
      documents: Parameters<typeof materializeChatDocuments>[2];
      pastes: StoredChatPaste[];
      displayText: string;
    }
  | Extract<SendChatMessageResult, { success: false }> => {
  const content = validateSendContent(input);
  if (!content.success) return content;
  // pendingSessionReplies covers accepted background work. isSessionRunActive is not
  // checked here because sendMessage registers lifecycle ownership before prepareSend.
  if (pendingSessionReplies.has(sessionId)) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }
  return { ...content, displayText: content.text };
};

const persistPreparedSend = async (
  ctx: LocalServerContext,
  input: {
    session: ChatSession;
    sessionId: string;
    messageId: string;
    assistantMessageId: string;
    runId: string;
    logFilePath: string;
    storedContent: string;
    displayText: string;
    workspacePath: string;
    contextStrategy: ChatContextStrategy;
    timeoutPolicy: string;
    now: string;
    action: ChatActionPayload | null;
    origin: MessageOrigin | null;
  },
): Promise<{ session: ChatSession; userMessage: ChatMessage; run: ChatRun }> =>
  ctx.eventPublisher.transaction(async (tx) => {
    const trx = tx.db;
    const turnIndex = await nextChatTurnIndex(trx, input.sessionId);
    const existing = await trx
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", input.sessionId)
      .limit(1)
      .executeTakeFirst();
    await trx
      .insertInto("chat_messages")
      .values({
        id: input.messageId,
        session_id: input.sessionId,
        role: "user",
        content: input.storedContent,
        action: input.action ? JSON.stringify(input.action) : null,
        turn_index: turnIndex,
        disposition: "immediate",
        created_at: input.now,
        origin_json: input.origin ? serializeMessageOrigin(input.origin) : null,
      })
      .execute();
    await trx
      .insertInto("chat_runs")
      .values({
        id: input.runId,
        session_id: input.sessionId,
        user_message_id: input.messageId,
        assistant_message_id: input.assistantMessageId,
        runtime: input.session.runtime,
        log_file_path: input.logFilePath,
        status: "running",
        runtime_session_id: input.session.runtime_session_id,
        resume_session_id: input.session.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: input.contextStrategy,
        workspace_path: input.workspacePath,
        timeout_policy: input.timeoutPolicy,
        retry_of_run_id: null,
        runtime_session_state: input.session.runtime_session_id ? "confirmed" : null,
        error_message: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
    const titlePatch = existing ? {} : deriveAutoTitle(input.session, input.displayText);
    await trx
      .updateTable("chat_sessions")
      .set({
        ...titlePatch,
        settled_override: null,
        settled_at: null,
        updated_at: input.now,
      })
      .where("id", "=", input.sessionId)
      .execute();

    const [session, userMessage, run] = await Promise.all([
      trx
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", input.sessionId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_messages")
        .selectAll()
        .where("id", "=", input.messageId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_runs")
        .selectAll()
        .where("id", "=", input.runId)
        .executeTakeFirstOrThrow(),
    ]);
    await ctx.sessionHooks.onUserMessageStored(tx, userMessage);
    return { session, userMessage, run };
  });

export const resolveCurrentSessionRuntimeConfiguration = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  session: ChatSession,
): Promise<
  | { success: true; session: ChatSession }
  | { success: false; error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } }
> => {
  if (!session.runtime_configuration_id) return { success: true, session };

  const resolution = await resolveRuntimeConfigurationPatch(runtimeConfigurations, session, {
    runtimeConfigurationId: session.runtime_configuration_id,
    model: session.model ?? undefined,
    reasoningEffort: session.reasoning_effort ?? undefined,
  });
  if (!resolution.success) {
    return { success: false, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } };
  }
  const updated = await ctx.chatSessionRepository.update(session.id, {
    ...resolution.patch,
    runtime_session_id: session.runtime_session_id,
    updated_at: new Date().toISOString(),
  });
  return updated
    ? { success: true, session: updated }
    : { success: false, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } };
};
