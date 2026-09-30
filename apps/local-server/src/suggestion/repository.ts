import type { SuggestionAnswer } from "@aop/common";
import type { Kysely } from "kysely";
import type { SuggestionAnswerRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

/** A message's answers, by the id of the suggestion each answers. */
export type MessageAnswers = ReadonlyMap<string, SuggestionAnswer>;

/**
 * The host's record of what the person did with each suggested thread (see migration v10). Make
 * it from a transaction's `db` and a write commits with the rest of that transaction.
 */
export interface SuggestionRepository {
  /** The answer to one suggestion, or null while it waits. */
  get: (messageId: string, suggestionId: string) => Promise<SuggestionAnswer | null>;
  /** The answers of these messages' suggestions, by message id. A message with none is left out. */
  listForMessages: (messageIds: readonly string[]) => Promise<ReadonlyMap<string, MessageAnswers>>;
  /**
   * Writes that the suggestion became this thread, over a skip if it was skipped. False, and
   * nothing written, when it was already started: a proposal starts once.
   */
  recordStarted: (messageId: string, suggestionId: string, threadId: string) => Promise<boolean>;
  /** Writes a skip. False, and nothing written, when the suggestion already has an answer. */
  recordSkipped: (messageId: string, suggestionId: string) => Promise<boolean>;
  /** Takes a skip back so the suggestion waits again. False when it was not skipped. */
  clearSkipped: (messageId: string, suggestionId: string) => Promise<boolean>;
  /** The messages holding a suggestion that this thread was started from. */
  messagesStartedAs: (threadId: string) => Promise<string[]>;
}

export const createSuggestionRepository = (db: Kysely<Database>): SuggestionRepository => ({
  get: async (messageId, suggestionId) => {
    const row = await db
      .selectFrom("suggestion_answers")
      .selectAll()
      .where("message_id", "=", messageId)
      .where("suggestion_id", "=", suggestionId)
      .executeTakeFirst();
    return row ? toAnswer(row) : null;
  },

  listForMessages: async (messageIds) => {
    if (messageIds.length === 0) return new Map();
    const rows = await db
      .selectFrom("suggestion_answers")
      .selectAll()
      .where("message_id", "in", messageIds)
      .execute();
    const byMessage = new Map<string, Map<string, SuggestionAnswer>>();
    for (const row of rows) {
      const answers = byMessage.get(row.message_id) ?? new Map<string, SuggestionAnswer>();
      answers.set(row.suggestion_id, toAnswer(row));
      byMessage.set(row.message_id, answers);
    }
    return byMessage;
  },

  recordStarted: async (messageId, suggestionId, threadId) => {
    const written = await db
      .insertInto("suggestion_answers")
      .values({
        message_id: messageId,
        suggestion_id: suggestionId,
        state: "started",
        thread_id: threadId,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["message_id", "suggestion_id"])
          .doUpdateSet({ state: "started", thread_id: threadId })
          .where("suggestion_answers.state", "=", "skipped"),
      )
      .executeTakeFirst();
    return Number(written.numInsertedOrUpdatedRows) > 0;
  },

  recordSkipped: async (messageId, suggestionId) => {
    const written = await db
      .insertInto("suggestion_answers")
      .values({
        message_id: messageId,
        suggestion_id: suggestionId,
        state: "skipped",
        thread_id: null,
      })
      .onConflict((conflict) => conflict.doNothing())
      .executeTakeFirst();
    return Number(written.numInsertedOrUpdatedRows) > 0;
  },

  clearSkipped: async (messageId, suggestionId) => {
    const removed = await db
      .deleteFrom("suggestion_answers")
      .where("message_id", "=", messageId)
      .where("suggestion_id", "=", suggestionId)
      .where("state", "=", "skipped")
      .executeTakeFirst();
    return Number(removed.numDeletedRows) > 0;
  },

  messagesStartedAs: async (threadId) => {
    const rows = await db
      .selectFrom("suggestion_answers")
      .select("message_id")
      .where("thread_id", "=", threadId)
      .execute();
    return rows.map((row) => row.message_id);
  },
});

const toAnswer = (row: SuggestionAnswerRow): SuggestionAnswer =>
  row.state === "started" && row.thread_id !== null
    ? { state: "started", threadId: row.thread_id }
    : { state: "skipped" };
