import type { ChatActionPayload } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import { loadTurnContext } from "../project/prompt-context.ts";
import { countRunningThreadRuns, readRunCap } from "../scheduling/capacity.ts";
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
import { type MessageOrigin, serializeMessageOrigin } from "./message-origin.ts";
import { consumeAnsweredMessages, readNextTurn } from "./report-batch.ts";
import {
  createSessionRunLogPath,
  isSessionRunActive,
  ownsSessionRunRegistration,
  type SessionRunRegistration,
} from "./runtime-engine.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "./runtime-timeout-policy.ts";
import { nextChatTurnIndex } from "./turn-order.ts";
import { resolveSessionWorkspaceBinding, WorkspaceBindingError } from "./workspace-binding.ts";

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
  | {
      success: false;
      reason:
        | "BUSY"
        | "EMPTY"
        | "SESSION_NOT_FOUND"
        | "CONFLICT"
        /** The session waits out a rate limit. */
        | "HELD"
        /** A thread's turn, and the host runs as many thread turns as it may. */
        | "FULL";
    }
  /** The session's workspace is gone, so the turn cannot start: `message` says why. */
  | { success: false; reason: "UNSTARTABLE"; message: string };

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
    origin?: MessageOrigin | null;
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

  const result = await ctx.eventPublisher.transaction(async (tx) => {
    const trx = tx.db;
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
        origin_json: input.origin ? serializeMessageOrigin(input.origin) : null,
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
    await ctx.sessionHooks.onUserMessageStored(tx, userMessage);
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
  const idle = await loadIdleSession(ctx, sessionId, pendingSessionReplies, registration);
  if ("reason" in idle) return idle;
  const session = idle;

  const oldest = await loadOldestQueuedMessage(ctx, sessionId);

  if (!oldest) return { success: false, reason: "EMPTY" };
  const { queued, alsoAnswered, decoded } = await readNextTurn(ctx, session, oldest);
  // Read before the transaction opens: a transaction holds the only connection.
  const runCap = session.kind === "thread" ? await readRunCap(ctx.settingsRepository) : null;

  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const logFilePath = await createSessionRunLogPath(sessionId);
  const workspace = await boundWorkspace(ctx, session);
  if ("error" in workspace) {
    return { success: false, reason: "UNSTARTABLE", message: workspace.error };
  }
  const globalInstructions = await loadChatGlobalInstructions(ctx.settingsRepository);
  const turnContext = await loadTurnContext(ctx, session, decoded.text);
  const basePrompt = buildRuntimePrompt(
    decoded.text,
    sessionId,
    decoded.images,
    decoded.documents,
    decoded.pastes,
    globalInstructions,
    turnContext,
  );
  const context = await prepareConversationPrompt({
    ctx,
    session,
    currentUserMessageId: queued.id,
    currentPrompt: basePrompt,
  });

  try {
    const claimed = await persistQueuedRun(ctx, {
      session,
      queued,
      alsoAnswered,
      sessionId,
      runId,
      assistantMessageId,
      logFilePath,
      contextStrategy: context.strategy,
      workspacePath: workspace.path,
      timeoutPolicy: CHAT_RUNTIME_TIMEOUT_POLICY.policyName,
      runCap,
    });

    if (claimed === "BUSY" || claimed === "FULL") return { success: false, reason: claimed };

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

// The session, when it can take a turn now: not running one and not waiting out a rate limit,
// which only its resume ends.
const loadIdleSession = async (
  ctx: LocalServerContext,
  sessionId: string,
  pendingSessionReplies: Set<string>,
  registration?: SessionRunRegistration,
): Promise<ChatSession | Extract<ClaimQueuedResult, { success: false }>> => {
  ctx.sessionMutationLock.assertAllowed("steer-claim", { sessionId });
  if (await isChatSessionBusy(ctx, sessionId, pendingSessionReplies, registration)) {
    return { success: false, reason: "BUSY" };
  }
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, reason: "SESSION_NOT_FOUND" };
  return session.resumes_at ? { success: false, reason: "HELD" } : session;
};

// A workspace that is gone (a deleted worktree, a removed repository) is the turn's failure to
// report, not an error to throw at whoever happened to trigger the queue.
const boundWorkspace = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<{ path: string } | { error: string }> => {
  try {
    return { path: await resolveSessionWorkspaceBinding(ctx, session) };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) return { error: error.message };
    throw error;
  }
};

export const loadOldestQueuedMessage = (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ChatMessage | undefined> =>
  ctx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .where("steered_run_id", "is", null)
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

export const persistQueuedRun = async (
  ctx: LocalServerContext,
  input: {
    session: ChatSession;
    queued: ChatMessage;
    /** Waiting messages this run answers along with `queued`; consumed in the same transaction. */
    alsoAnswered?: ChatMessage[];
    sessionId: string;
    runId: string;
    assistantMessageId: string;
    logFilePath: string;
    contextStrategy: ChatRun["context_strategy"];
    /** Null for a turn that failed before it could start, which has no workspace to run in. */
    workspacePath: string | null;
    timeoutPolicy: string;
    /** How many thread runs the host allows at once; null for a session that is not a thread. */
    runCap: number | null;
  },
): Promise<{ run: ChatRun; userMessage: ChatMessage } | "BUSY" | "FULL"> =>
  ctx.eventPublisher.transaction(async (tx) => {
    const trx = tx.db;
    const active = await trx
      .selectFrom("chat_runs")
      .select("id")
      .where("session_id", "=", input.sessionId)
      .where("status", "=", "running")
      .executeTakeFirst();
    if (active) return "BUSY";
    // The cap is enforced where runs are made, in the transaction that makes one, so a claim that
    // races another can never take a slot the other has just filled.
    if (input.runCap !== null && (await countRunningThreadRuns(trx)) >= input.runCap) return "FULL";

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
        created_at: claimedAt,
        updated_at: claimedAt,
      })
      .execute();
    await consumeAnsweredMessages(trx, input, claimedAt);
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
    await ctx.sessionHooks.onTurnScheduled(tx, input.sessionId, "running");
    return { run, userMessage };
  });

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
    .where("steered_run_id", "is", null)
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
  // Stopping a turn that could not start because its workspace is gone must still work.
  const workspace = session ? await boundWorkspace(ctx, session) : null;
  const workspacePath = workspace && "path" in workspace ? workspace.path : null;

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
      timeout_policy: CHAT_RUNTIME_TIMEOUT_POLICY.policyName,
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
