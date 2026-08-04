import { randomUUID } from "node:crypto";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import { prepareConversationPrompt } from "./conversation-history.ts";
import {
  buildRuntimePrompt,
  decodeStoredAttachmentMetadata,
  loadChatGlobalInstructions,
  type StoredChatDocument,
  type StoredChatImage,
} from "./message-images.ts";
import { createSessionRunLogPath, isGrokRuntime } from "./runtime-engine.ts";
import { resolveChatRuntimeTimeoutPolicy } from "./runtime-timeout-policy.ts";
import { nextChatTurnIndex } from "./turn-order.ts";
import { resolveSessionWorkspaceBinding } from "./workspace-binding.ts";

type FreshRetryError =
  | { code: "SESSION_NOT_FOUND" }
  | { code: "RUN_NOT_RETRYABLE" }
  | { code: "CONFIRMATION_REQUIRED" };

export type PreparedFreshRetry =
  | { success: false; error: FreshRetryError }
  | {
      success: true;
      existing: boolean;
      session: ChatSession;
      message: ChatMessage;
      run: ChatRun;
      runtimePrompt: string;
      displayText: string;
      images: StoredChatImage[];
      documents: StoredChatDocument[];
    };

export const prepareFreshRetry = async (
  ctx: LocalServerContext,
  sessionId: string,
  runId: string,
  confirmed: unknown,
): Promise<PreparedFreshRetry> => {
  if (confirmed !== true) return { success: false, error: { code: "CONFIRMATION_REQUIRED" } };
  const source = await loadRetrySource(ctx, sessionId, runId);
  if (!source.success) return source;

  const decoded = decodeStoredAttachmentMetadata(source.message.content);
  if (source.existing) {
    const retryMessage = await ctx.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", source.existing.user_message_id)
      .executeTakeFirstOrThrow();
    return preparedResult(
      true,
      source.session,
      retryMessage,
      source.existing,
      decoded.text,
      "",
      decoded.images,
      decoded.documents,
    );
  }

  const messageId = generateTypeId("smsg");
  const retrySession = { ...source.session, runtime_session_id: null };
  const workspacePath = await resolveSessionWorkspaceBinding(ctx, retrySession);
  const globalInstructions = await loadChatGlobalInstructions(ctx.settingsRepository);
  const basePrompt = buildRuntimePrompt(
    decoded.text,
    sessionId,
    decoded.images,
    decoded.documents,
    decoded.pastes,
    globalInstructions,
  );
  const context = await prepareConversationPrompt({
    ctx,
    session: retrySession,
    currentUserMessageId: messageId,
    currentPrompt: basePrompt,
    excludeMessageIds: [source.message.id],
  });
  const retryRunId = generateTypeId("crun");
  const run = await persistFreshRetry(ctx, {
    session: source.session,
    originalContent: source.message.content,
    originalRunId: runId,
    messageId,
    retryRunId,
    workspacePath,
  });
  if (!run) {
    const concurrent = await loadExistingRetry(ctx, runId);
    if (!concurrent) {
      throw new Error(`Retry insertion conflicted without a durable retry for ${runId}`);
    }
    const retryMessage = await ctx.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", concurrent.user_message_id)
      .executeTakeFirstOrThrow();
    return preparedResult(
      true,
      retrySession,
      retryMessage,
      concurrent,
      decoded.text,
      "",
      decoded.images,
      decoded.documents,
    );
  }

  const [message, updatedSession] = await Promise.all([
    ctx.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirstOrThrow(),
    ctx.chatSessionRepository.getById(sessionId),
  ]);
  return preparedResult(
    false,
    updatedSession ?? retrySession,
    message,
    run,
    decoded.text,
    context.prompt,
    decoded.images,
    decoded.documents,
  );
};

const loadRetrySource = async (
  ctx: LocalServerContext,
  sessionId: string,
  runId: string,
): Promise<
  | { success: false; error: FreshRetryError }
  | {
      success: true;
      session: ChatSession;
      message: ChatMessage;
      existing: ChatRun | null;
    }
> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const run = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", runId)
    .where("session_id", "=", sessionId)
    .executeTakeFirst();
  if (run?.status !== "failed" || run.failure_kind !== "startup_timeout") {
    return { success: false, error: { code: "RUN_NOT_RETRYABLE" } };
  }
  const [message, existing] = await Promise.all([
    ctx.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", run.user_message_id)
      .executeTakeFirstOrThrow(),
    loadExistingRetry(ctx, runId),
  ]);
  return { success: true, session, message, existing };
};

const persistFreshRetry = async (
  ctx: LocalServerContext,
  input: {
    session: ChatSession;
    originalContent: string;
    originalRunId: string;
    messageId: string;
    retryRunId: string;
    workspacePath: string;
  },
): Promise<ChatRun | null> => {
  const allocatedSessionId = isGrokRuntime(input.session.runtime) ? randomUUID() : null;
  const timeoutPolicy = resolveChatRuntimeTimeoutPolicy(input.session.runtime);
  const logFilePath = await createSessionRunLogPath(input.session.id);
  const now = new Date().toISOString();
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const turnIndex = await nextChatTurnIndex(trx, input.session.id);
      await trx
        .insertInto("chat_messages")
        .values({
          id: input.messageId,
          session_id: input.session.id,
          role: "user",
          content: input.originalContent,
          action: null,
          turn_index: turnIndex,
          disposition: "retry",
          created_at: now,
        })
        .execute();
      await trx
        .insertInto("chat_runs")
        .values({
          id: input.retryRunId,
          session_id: input.session.id,
          user_message_id: input.messageId,
          assistant_message_id: generateTypeId("smsg"),
          runtime: input.session.runtime,
          log_file_path: logFilePath,
          status: "running",
          runtime_session_id: allocatedSessionId,
          resume_session_id: null,
          failure_kind: null,
          interruption_kind: null,
          context_strategy: "aop_history",
          workspace_path: input.workspacePath,
          timeout_policy: timeoutPolicy.policyName,
          retry_of_run_id: input.originalRunId,
          runtime_session_state: allocatedSessionId ? "allocated" : null,
          error_message: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await trx
        .updateTable("chat_sessions")
        .set({
          runtime_session_id: null,
          settled_override: null,
          settled_at: null,
          updated_at: now,
        })
        .where("id", "=", input.session.id)
        .execute();
      return trx
        .selectFrom("chat_runs")
        .selectAll()
        .where("id", "=", input.retryRunId)
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    if (isRetryUniqueConflict(error)) return null;
    throw error;
  }
};

const loadExistingRetry = async (ctx: LocalServerContext, runId: string): Promise<ChatRun | null> =>
  (await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("retry_of_run_id", "=", runId)
    .executeTakeFirst()) ?? null;

const isRetryUniqueConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("uq_chat_runs_retry_of_run") ||
    message.includes("UNIQUE constraint failed: chat_runs.retry_of_run_id")
  );
};

const preparedResult = (
  existing: boolean,
  session: ChatSession,
  message: ChatMessage,
  run: ChatRun,
  displayText: string,
  runtimePrompt: string,
  images: StoredChatImage[],
  documents: StoredChatDocument[],
): Extract<PreparedFreshRetry, { success: true }> => ({
  success: true,
  existing,
  session,
  message,
  run,
  displayText,
  runtimePrompt,
  images,
  documents,
});
