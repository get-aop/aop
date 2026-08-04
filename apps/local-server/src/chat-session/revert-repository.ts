import type { Kysely } from "kysely";
import type {
  ChatRevertOperation,
  ChatRevertOperationStatus,
  ChatRevertOperationUpdate,
  NewChatRevertOperation,
} from "../db/chat-history-schema.ts";
import type { ChatMessage, ChatRun, Database } from "../db/schema.ts";
import {
  planCleanupJobs,
  toCheckpointRefRow,
  toRevertRefRow,
} from "./checkpoint-cleanup-manifest.ts";
import { insertChatCheckpointCleanupJobs } from "./checkpoint-cleanup-repository.ts";
import { deleteRunGraph, listCheckpointsByRunIds } from "./history-rows.ts";

/** History trimming is only ever allowed while the operation is mid-apply. */
export const TRIMMABLE_REVERT_STATUS: ChatRevertOperationStatus = "applying";

export type ChatRevertTrimErrorCode =
  | "OPERATION_NOT_FOUND"
  | "OPERATION_STATUS_MISMATCH"
  | "TARGET_MESSAGE_MISMATCH"
  | "TARGET_RUN_MISMATCH"
  | "OPERATION_UPDATE_CONFLICT";

export class ChatRevertTrimError extends Error {
  readonly code: ChatRevertTrimErrorCode;

  constructor(code: ChatRevertTrimErrorCode, message: string) {
    super(message);
    this.name = "ChatRevertTrimError";
    this.code = code;
  }
}

export interface ChatRevertTargetSelection {
  targetUserMessage: ChatMessage;
  targetAssistantMessage: ChatMessage | null;
  targetRun: ChatRun;
  messages: ChatMessage[];
  runs: ChatRun[];
}

/**
 * Only the operation id is caller-supplied. Session and turn are derived from
 * the stored operation so a caller can never trim a different conversation.
 */
export interface ChatHistoryTrimInput {
  operationId: string;
  completedAt: string;
}

export interface ChatHistoryTrimResult {
  sessionId: string;
  targetTurnIndex: number;
  removedMessageCount: number;
  removedRunCount: number;
  cleanupJobIds: string[];
}

export interface ChatRevertRepository {
  create: (operation: NewChatRevertOperation) => Promise<ChatRevertOperation>;
  update: (id: string, patch: ChatRevertOperationUpdate) => Promise<ChatRevertOperation | null>;
  listNeedingRecoveryOrCleanup: () => Promise<ChatRevertOperation[]>;
  selectTargetAndLater: (
    sessionId: string,
    userMessageId: string,
  ) => Promise<ChatRevertTargetSelection | null>;
  trimHistory: (input: ChatHistoryTrimInput) => Promise<ChatHistoryTrimResult>;
}

export const createChatRevertRepository = (db: Kysely<Database>): ChatRevertRepository => ({
  create: async (operation) => {
    await db.insertInto("chat_revert_operations").values(operation).execute();
    return db
      .selectFrom("chat_revert_operations")
      .selectAll()
      .where("id", "=", operation.id)
      .executeTakeFirstOrThrow();
  },

  update: async (id, patch) => {
    await db.updateTable("chat_revert_operations").set(patch).where("id", "=", id).execute();
    return (
      (await db
        .selectFrom("chat_revert_operations")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst()) ?? null
    );
  },

  listNeedingRecoveryOrCleanup: () =>
    db
      .selectFrom("chat_revert_operations")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("status", "in", ["applying", "rollback_pending", "recovery_required"]),
          eb("cleanup_status", "in", ["pending", "failed"]),
        ]),
      )
      .orderBy("created_at")
      .orderBy("id")
      .execute(),

  selectTargetAndLater: (sessionId, userMessageId) =>
    selectTargetAndLater(db, sessionId, userMessageId),

  trimHistory: (input) => trimHistory(db, input),
});

const selectTargetAndLater = async (
  db: Kysely<Database>,
  sessionId: string,
  userMessageId: string,
): Promise<ChatRevertTargetSelection | null> => {
  const targetUserMessage = await db
    .selectFrom("chat_messages")
    .selectAll()
    .where("id", "=", userMessageId)
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .executeTakeFirst();
  if (!targetUserMessage) return null;

  const targetRun = await db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("user_message_id", "=", userMessageId)
    .executeTakeFirst();
  if (!targetRun) return null;

  const [targetAssistantMessage, messages, runs] = await Promise.all([
    db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", targetRun.assistant_message_id)
      .where("session_id", "=", sessionId)
      .executeTakeFirst(),
    db
      .selectFrom("chat_messages")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("turn_index", ">=", targetUserMessage.turn_index)
      .orderBy("turn_index")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    listRunsAtOrAfterTurn(db, sessionId, targetUserMessage.turn_index),
  ]);

  return {
    targetUserMessage,
    targetAssistantMessage: targetAssistantMessage ?? null,
    targetRun,
    messages,
    runs,
  };
};

/**
 * Validates the operation, records identity-complete cleanup jobs, and only
 * then deletes rows child-first. Any rejection leaves messages, runs,
 * checkpoints, the session, and the operation exactly as they were.
 */
const trimHistory = async (
  db: Kysely<Database>,
  input: ChatHistoryTrimInput,
): Promise<ChatHistoryTrimResult> =>
  db.transaction().execute(async (trx) => {
    const operation = await requireTrimmableOperation(trx, input.operationId);
    const { sessionId, targetTurnIndex } = await requireOperationTarget(trx, operation);

    const runs = await listRunsAtOrAfterTurn(trx, sessionId, targetTurnIndex);
    const runIds = runs.map((run) => run.id);
    const checkpoints = await listCheckpointsByRunIds(trx, runIds);

    const jobs = planCleanupJobs({
      checkpoints: checkpoints.map(toCheckpointRefRow),
      revertOperations: [toRevertRefRow(operation)],
      runSessionIds: new Map(runs.map((run) => [run.id, run.session_id])),
      now: input.completedAt,
    });
    // Durable cleanup must exist before the rows that name these refs disappear.
    await insertChatCheckpointCleanupJobs(trx, jobs);

    await deleteRunGraph(trx, runIds);
    const deletedMessages = await trx
      .deleteFrom("chat_messages")
      .where("session_id", "=", sessionId)
      .where("turn_index", ">=", targetTurnIndex)
      .executeTakeFirst();

    await trx
      .updateTable("chat_sessions")
      .set({
        runtime_session_id: null,
        last_read_at: input.completedAt,
        updated_at: input.completedAt,
      })
      .where("id", "=", sessionId)
      .execute();

    const applied = await trx
      .updateTable("chat_revert_operations")
      .set({
        status: "applied",
        cleanup_status: "pending",
        error_message: null,
        completed_at: input.completedAt,
        updated_at: input.completedAt,
      })
      .where("id", "=", operation.id)
      .where("status", "=", TRIMMABLE_REVERT_STATUS)
      .executeTakeFirst();
    if (Number(applied.numUpdatedRows ?? 0) !== 1) {
      throw new ChatRevertTrimError(
        "OPERATION_UPDATE_CONFLICT",
        `Revert operation ${operation.id} changed status while trimming history`,
      );
    }

    return {
      sessionId,
      targetTurnIndex,
      removedMessageCount: Number(deletedMessages.numDeletedRows ?? 0),
      removedRunCount: runIds.length,
      cleanupJobIds: jobs.map((job) => job.id),
    };
  });

const requireTrimmableOperation = async (
  db: Kysely<Database>,
  operationId: string,
): Promise<ChatRevertOperation> => {
  const operation = await db
    .selectFrom("chat_revert_operations")
    .selectAll()
    .where("id", "=", operationId)
    .executeTakeFirst();
  if (!operation) {
    throw new ChatRevertTrimError(
      "OPERATION_NOT_FOUND",
      `Revert operation ${operationId} does not exist`,
    );
  }
  if (operation.status !== TRIMMABLE_REVERT_STATUS) {
    throw new ChatRevertTrimError(
      "OPERATION_STATUS_MISMATCH",
      `Revert operation ${operationId} is ${operation.status}, expected ${TRIMMABLE_REVERT_STATUS}`,
    );
  }
  return operation;
};

const requireOperationTarget = async (
  db: Kysely<Database>,
  operation: ChatRevertOperation,
): Promise<{ sessionId: string; targetTurnIndex: number }> => {
  const message = await db
    .selectFrom("chat_messages")
    .selectAll()
    .where("id", "=", operation.target_user_message_id)
    .executeTakeFirst();
  if (
    !message ||
    message.session_id !== operation.session_id ||
    message.role !== "user" ||
    message.turn_index !== operation.target_turn_index
  ) {
    throw new ChatRevertTrimError(
      "TARGET_MESSAGE_MISMATCH",
      `Revert operation ${operation.id} no longer matches its stored target message`,
    );
  }

  const run = await db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", operation.target_run_id)
    .executeTakeFirst();
  if (!run || run.session_id !== operation.session_id || run.user_message_id !== message.id) {
    throw new ChatRevertTrimError(
      "TARGET_RUN_MISMATCH",
      `Revert operation ${operation.id} no longer matches its stored target run`,
    );
  }

  return { sessionId: operation.session_id, targetTurnIndex: message.turn_index };
};

const listRunsAtOrAfterTurn = (
  db: Kysely<Database>,
  sessionId: string,
  targetTurnIndex: number,
): Promise<ChatRun[]> =>
  db
    .selectFrom("chat_runs")
    .innerJoin("chat_messages", "chat_messages.id", "chat_runs.user_message_id")
    .selectAll("chat_runs")
    .where("chat_runs.session_id", "=", sessionId)
    .where("chat_messages.turn_index", ">=", targetTurnIndex)
    .orderBy("chat_messages.turn_index")
    .orderBy("chat_runs.created_at")
    .orderBy("chat_runs.id")
    .execute();
