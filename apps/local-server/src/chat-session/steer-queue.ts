import { randomUUID } from "node:crypto";
import type { ChatActionPayload } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import { prepareConversationPrompt } from "./conversation-history.ts";
import {
  buildRuntimePrompt,
  decodeStoredAttachmentMetadata,
  encodeMessageContent,
  loadChatGlobalInstructions,
  materializeChatDocuments,
  materializeChatImages,
  type StoredChatDocument,
  type StoredChatImage,
  validateChatDocumentAttachments,
  validateChatImageAttachments,
} from "./message-images.ts";
import {
  createSessionRunLogPath,
  isSessionRunActive,
  ownsSessionRunRegistration,
  type SessionRunRegistration,
} from "./runtime-engine.ts";
import { resolveChatRuntimeTimeoutPolicy } from "./runtime-timeout-policy.ts";
import { nextChatTurnIndex } from "./turn-order.ts";
import { resolveSessionWorkspaceBinding } from "./workspace-binding.ts";

export type SteerStoreResult =
  | {
      success: true;
      session: ChatSession;
      userMessage: ChatMessage;
      displayText: string;
    }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "INVALID_CONTENT" }
        | { code: "INVALID_IMAGES"; message: string }
        | { code: "INVALID_DOCUMENTS"; message: string };
    };

export type ClaimQueuedResult =
  | {
      success: true;
      session: ChatSession;
      userMessage: ChatMessage;
      displayText: string;
      runtimePrompt: string;
      images: StoredChatImage[];
      documents: StoredChatDocument[];
      run: ChatRun;
    }
  | { success: false; reason: "BUSY" | "EMPTY" | "SESSION_NOT_FOUND" | "CONFLICT" };

/** True when a reply is claimed, in-memory active, or durable running. */
export const isChatSessionBusy = async (
  ctx: LocalServerContext,
  sessionId: string,
  pendingSessionReplies: Set<string>,
  registration?: SessionRunRegistration,
): Promise<boolean> => {
  const ownedRegistration = registration && ownsSessionRunRegistration(registration);
  if (
    (isSessionRunActive(sessionId) && !ownedRegistration) ||
    pendingSessionReplies.has(sessionId)
  ) {
    return true;
  }
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return Boolean(run);
};

/** Persist a user message without starting a run (mid-run steer). */
export const storeSteerUserMessage = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: {
    content: unknown;
    imageAttachments?: unknown;
    documentAttachments?: unknown;
    action?: ChatActionPayload | null;
  },
  disposition: "queued" | "steered",
): Promise<SteerStoreResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

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
  if (!text && imagesResult.images.length === 0 && documentsResult.documents.length === 0) {
    return { success: false, error: { code: "INVALID_CONTENT" } };
  }

  const messageId = generateTypeId("smsg");
  const storedImages = await materializeChatImages(sessionId, messageId, imagesResult.images);
  const storedDocuments = await materializeChatDocuments(
    sessionId,
    messageId,
    documentsResult.documents,
  );
  const storedContent = encodeMessageContent(text, storedImages, storedDocuments);
  const now = new Date().toISOString();

  const result = await ctx.db.transaction().execute(async (trx) => {
    const turnIndex = await nextChatTurnIndex(trx, sessionId);
    const existing = await trx
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", sessionId)
      .limit(1)
      .executeTakeFirst();
    await trx
      .insertInto("chat_messages")
      .values({
        id: messageId,
        session_id: sessionId,
        role: "user",
        content: storedContent,
        action: input.action ? JSON.stringify(input.action) : null,
        turn_index: turnIndex,
        disposition,
        created_at: now,
      })
      .execute();

    const titlePatch = existing ? {} : deriveSteerAutoTitle(session, text);
    await trx
      .updateTable("chat_sessions")
      .set({ ...titlePatch, settled_override: null, settled_at: null, updated_at: now })
      .where("id", "=", sessionId)
      .execute();

    const [updated, userMessage] = await Promise.all([
      trx
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", sessionId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_messages")
        .selectAll()
        .where("id", "=", messageId)
        .executeTakeFirstOrThrow(),
    ]);
    return { session: updated, userMessage };
  });

  return {
    success: true,
    session: result.session,
    userMessage: result.userMessage,
    displayText: text,
  };
};

/**
 * Claim the oldest user message that has no chat_run yet and open a running run for it.
 * One running run per session remains enforced by the partial unique index.
 */
export const claimNextQueuedSteer = async (
  ctx: LocalServerContext,
  sessionId: string,
  pendingSessionReplies: Set<string>,
  registration?: SessionRunRegistration,
): Promise<ClaimQueuedResult> => {
  ctx.sessionMutationLock.assertAllowed("steer-claim", { sessionId });
  if (await isChatSessionBusy(ctx, sessionId, pendingSessionReplies, registration)) {
    return { success: false, reason: "BUSY" };
  }

  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, reason: "SESSION_NOT_FOUND" };

  const queued = await loadOldestQueuedMessage(ctx, sessionId);

  if (!queued) return { success: false, reason: "EMPTY" };

  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const logFilePath = await createSessionRunLogPath(sessionId);
  const decoded = decodeStoredImages(queued.content);
  const workspacePath = await resolveSessionWorkspaceBinding(ctx, session);
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
    session,
    currentUserMessageId: queued.id,
    currentPrompt: basePrompt,
  });
  const allocatedSessionId =
    !session.runtime_session_id && (session.runtime === "grok-build" || session.runtime === "grok")
      ? randomUUID()
      : null;
  const timeoutPolicy = resolveChatRuntimeTimeoutPolicy(session.runtime);

  try {
    const claimed = await persistQueuedRun(ctx, {
      session,
      queued,
      sessionId,
      runId,
      assistantMessageId,
      logFilePath,
      allocatedSessionId,
      contextStrategy: context.strategy,
      workspacePath,
      timeoutPolicy: timeoutPolicy.policyName,
    });

    if (!claimed) return { success: false, reason: "BUSY" };

    return {
      success: true,
      session,
      userMessage: claimed.userMessage,
      displayText: decoded.text,
      runtimePrompt: context.prompt,
      images: decoded.images,
      documents: decoded.documents,
      run: claimed.run,
    };
  } catch (error) {
    if (isQueuedRunConflict(error)) return { success: false, reason: "CONFLICT" };
    throw error;
  }
};

const loadOldestQueuedMessage = (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ChatMessage | undefined> =>
  ctx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .orderBy("turn_index", "asc")
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .limit(1)
    .executeTakeFirst();

const persistQueuedRun = async (
  ctx: LocalServerContext,
  input: {
    session: ChatSession;
    queued: ChatMessage;
    sessionId: string;
    runId: string;
    assistantMessageId: string;
    logFilePath: string;
    allocatedSessionId: string | null;
    contextStrategy: ChatRun["context_strategy"];
    workspacePath: string;
    timeoutPolicy: string;
  },
): Promise<{ run: ChatRun; userMessage: ChatMessage } | null> =>
  ctx.db.transaction().execute(async (trx) => {
    const active = await trx
      .selectFrom("chat_runs")
      .select("id")
      .where("session_id", "=", input.sessionId)
      .where("status", "=", "running")
      .executeTakeFirst();
    if (active) return null;

    const claimedAt = new Date().toISOString();
    await trx
      .insertInto("chat_runs")
      .values({
        id: input.runId,
        session_id: input.sessionId,
        user_message_id: input.queued.id,
        assistant_message_id: input.assistantMessageId,
        runtime: input.session.runtime,
        log_file_path: input.logFilePath,
        status: "running",
        runtime_session_id: input.allocatedSessionId ?? input.session.runtime_session_id,
        resume_session_id: input.session.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: input.contextStrategy,
        workspace_path: input.workspacePath,
        timeout_policy: input.timeoutPolicy,
        retry_of_run_id: null,
        runtime_session_state: queuedRuntimeSessionState(input),
        error_message: null,
        created_at: claimedAt,
        updated_at: claimedAt,
      })
      .execute();
    // Drop mid-run labels once the turn is claimed so the UI stops saying
    // "Steering/Queued" after the follow-up reply has started (or finished).
    await trx
      .updateTable("chat_messages")
      .set({ disposition: "immediate" })
      .where("id", "=", input.queued.id)
      .execute();
    const [run, userMessage] = await Promise.all([
      trx
        .selectFrom("chat_runs")
        .selectAll()
        .where("id", "=", input.runId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_messages")
        .selectAll()
        .where("id", "=", input.queued.id)
        .executeTakeFirstOrThrow(),
    ]);
    return { run, userMessage };
  });

const queuedRuntimeSessionState = (input: {
  allocatedSessionId: string | null;
  session: ChatSession;
}): "allocated" | "confirmed" | null => {
  if (input.allocatedSessionId) return "allocated";
  return input.session.runtime_session_id ? "confirmed" : null;
};

const isQueuedRunConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "uq_chat_runs_running_session",
    "UNIQUE constraint failed: chat_runs.session_id",
    "uq_chat_runs_user_message",
  ].some((fragment) => message.includes(fragment));
};

/** Prevent queued mid-run messages from starting after the user stops the conversation. */
export const cancelQueuedSteers = async (
  ctx: LocalServerContext,
  sessionId: string,
  runtime: string,
  interruptionKind: "abort" | "reset" = "abort",
): Promise<number> => {
  const queued = await ctx.db
    .selectFrom("chat_messages")
    .select(["id", "created_at"])
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .execute();
  if (queued.length === 0) return 0;

  const session = await ctx.chatSessionRepository.getById(sessionId);
  const workspacePath = session ? await resolveSessionWorkspaceBinding(ctx, session) : null;
  const timeoutPolicy = resolveChatRuntimeTimeoutPolicy(runtime);

  const now = new Date().toISOString();
  const rows = await Promise.all(
    queued.map(async (message) => ({
      id: generateTypeId("crun"),
      session_id: sessionId,
      user_message_id: message.id,
      assistant_message_id: generateTypeId("smsg"),
      runtime,
      log_file_path: await createSessionRunLogPath(sessionId),
      status: "cancelled" as const,
      runtime_session_id: null,
      resume_session_id: null,
      failure_kind: null,
      interruption_kind: interruptionKind,
      context_strategy: session?.runtime_session_id
        ? ("native_resume" as const)
        : ("aop_history" as const),
      workspace_path: workspacePath,
      timeout_policy: timeoutPolicy.policyName,
      retry_of_run_id: null,
      runtime_session_state: session?.runtime_session_id ? ("confirmed" as const) : null,
      error_message: null,
      created_at: message.created_at,
      updated_at: now,
    })),
  );
  await ctx.db.insertInto("chat_runs").values(rows).execute();
  return rows.length;
};

/** Rehydrate stored attachment metadata from the message content encoding. */
export const decodeStoredImages = decodeStoredAttachmentMetadata;

const deriveSteerAutoTitle = (
  session: Pick<ChatSession, "named" | "title">,
  text: string,
): { title?: string } => {
  if (session.named) return {};
  const stripped = text
    .replace(/^\/\w+\s*(run\s+)?/i, "")
    .replace(/@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
  if (!stripped) return {};
  return { title: stripped };
};
