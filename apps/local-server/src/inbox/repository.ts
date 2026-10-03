import type { InboxView } from "@aop/common";
import type {
  Expression,
  ExpressionBuilder,
  Insertable,
  Kysely,
  Selectable,
  SqlBool,
  Updateable,
} from "kysely";
import type {
  InboxDatabase,
  InboxItemsTable,
  InboxLinksTable,
  InboxSentTable,
} from "./database.ts";

export type InboxItemRow = Selectable<InboxItemsTable>;
export type InboxLinkRow = Selectable<InboxLinksTable>;
export type ItemPatch = Updateable<InboxItemsTable>;

/** Where a page starts: the last item of the page before, by time and then id. */
export interface ListCursor {
  receivedAt: string;
  id: string;
}

export interface InboxRepository {
  get: (id: string) => Promise<InboxItemRow | null>;
  findByKey: (sourceId: string, itemKey: string) => Promise<InboxItemRow | null>;
  findByMessage: (
    sourceId: string,
    conversationId: string,
    messageId: string,
  ) => Promise<InboxItemRow | null>;
  insert: (row: Insertable<InboxItemsTable>) => Promise<void>;
  update: (id: string, patch: ItemPatch) => Promise<void>;
  list: (
    view: InboxView,
    now: string,
    limit: number,
    after: ListCursor | null,
    conversations?: readonly string[],
  ) => Promise<InboxItemRow[]>;
  countUnread: (now: string) => Promise<number>;
  linksOf: (itemIds: readonly string[]) => Promise<InboxLinkRow[]>;
  insertLink: (row: Insertable<InboxLinksTable>) => Promise<void>;
  deleteLink: (itemId: string, linkId: string) => Promise<boolean>;
  updateLink: (
    itemId: string,
    linkId: string,
    patch: Updateable<InboxLinksTable>,
  ) => Promise<boolean>;
  /** Thread links whose pull request the host still follows (none yet, or open). */
  watchedThreadLinks: () => Promise<InboxLinkRow[]>;
  /** Threads the person is part of, active since `since`, most recent first. */
  activeThreads: (
    sourceId: string,
    since: string,
    limit: number,
  ) => Promise<Array<{ conversationId: string; threadId: string }>>;
  noteSent: (row: Insertable<InboxSentTable>) => Promise<void>;
  /** Which of these messages the person sent from AOP. */
  sentFrom: (
    sourceId: string,
    conversationId: string,
    messageIds: readonly string[],
  ) => Promise<Set<string>>;
  isKnownThread: (sourceId: string, conversationId: string, threadId: string) => Promise<boolean>;
  touchThread: (
    sourceId: string,
    conversationId: string,
    threadId: string,
    at: string,
  ) => Promise<void>;
  /** Items last active before `cutoff`: linked ones lose their text, the rest go. */
  expireBefore: (cutoff: string, at: string) => Promise<{ expired: number; removed: number }>;
  forgetThreadsBefore: (cutoff: string) => Promise<number>;
}

export const createInboxRepository = (db: Kysely<InboxDatabase>): InboxRepository => ({
  get: async (id) =>
    (await db.selectFrom("inbox_items").selectAll().where("id", "=", id).executeTakeFirst()) ??
    null,

  findByKey: async (sourceId, itemKey) =>
    (await db
      .selectFrom("inbox_items")
      .selectAll()
      .where("source_id", "=", sourceId)
      .where("item_key", "=", itemKey)
      .executeTakeFirst()) ?? null,

  findByMessage: async (sourceId, conversationId, messageId) =>
    (await db
      .selectFrom("inbox_items")
      .selectAll()
      .where("source_id", "=", sourceId)
      .where("conversation_id", "=", conversationId)
      .where("message_id", "=", messageId)
      .executeTakeFirst()) ?? null,

  insert: async (row) => {
    await db.insertInto("inbox_items").values(row).execute();
  },

  update: async (id, patch) => {
    await db.updateTable("inbox_items").set(patch).where("id", "=", id).execute();
  },

  list: async (view, now, limit, after, conversations) => {
    let query = db
      .selectFrom("inbox_items")
      .selectAll()
      .where((eb) => viewFilter(eb, view, now));
    if (conversations) {
      if (conversations.length === 0) return [];
      query = query.where("conversation_id", "in", [...conversations]);
    }
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb("received_at", "<", after.receivedAt),
          eb.and([eb("received_at", "=", after.receivedAt), eb("id", "<", after.id)]),
        ]),
      );
    }
    return query.orderBy("received_at", "desc").orderBy("id", "desc").limit(limit).execute();
  },

  countUnread: async (now) => {
    const row = await db
      .selectFrom("inbox_items")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where((eb) => eb.or([eb("state", "=", "unread"), snoozeDue(eb, now)]))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  },

  linksOf: async (itemIds) =>
    itemIds.length === 0
      ? []
      : db
          .selectFrom("inbox_links")
          .selectAll()
          .where("item_id", "in", [...itemIds])
          .orderBy("created_at")
          .orderBy("id")
          .execute(),

  insertLink: async (row) => {
    await db
      .insertInto("inbox_links")
      .values(row)
      .onConflict((oc) => oc.columns(["item_id", "kind", "ref"]).doNothing())
      .execute();
  },

  deleteLink: async (itemId, linkId) => {
    const result = await db
      .deleteFrom("inbox_links")
      .where("item_id", "=", itemId)
      .where("id", "=", linkId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },

  updateLink: async (itemId, linkId, patch) => {
    const result = await db
      .updateTable("inbox_links")
      .set(patch)
      .where("item_id", "=", itemId)
      .where("id", "=", linkId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  },

  watchedThreadLinks: () =>
    db
      .selectFrom("inbox_links")
      .selectAll()
      .where("kind", "=", "thread")
      .where((eb) => eb.or([eb("pr_noted", "is", null), eb("pr_noted", "=", "opened")]))
      .execute(),

  activeThreads: async (sourceId, since, limit) =>
    (
      await db
        .selectFrom("inbox_threads")
        .select(["conversation_id", "thread_id"])
        .where("source_id", "=", sourceId)
        .where("touched_at", ">=", since)
        .orderBy("touched_at", "desc")
        .limit(limit)
        .execute()
    ).map((row) => ({ conversationId: row.conversation_id, threadId: row.thread_id })),

  noteSent: async (row) => {
    await db
      .insertInto("inbox_sent")
      .values(row)
      .onConflict((oc) => oc.columns(["source_id", "conversation_id", "message_id"]).doNothing())
      .execute();
  },

  sentFrom: async (sourceId, conversationId, messageIds) =>
    messageIds.length === 0
      ? new Set()
      : new Set(
          (
            await db
              .selectFrom("inbox_sent")
              .select("message_id")
              .where("source_id", "=", sourceId)
              .where("conversation_id", "=", conversationId)
              .where("message_id", "in", [...messageIds])
              .execute()
          ).map((row) => row.message_id),
        ),

  isKnownThread: async (sourceId, conversationId, threadId) =>
    (await db
      .selectFrom("inbox_threads")
      .select("thread_id")
      .where("source_id", "=", sourceId)
      .where("conversation_id", "=", conversationId)
      .where("thread_id", "=", threadId)
      .executeTakeFirst()) !== undefined,

  touchThread: async (sourceId, conversationId, threadId, at) => {
    await db
      .insertInto("inbox_threads")
      .values({
        source_id: sourceId,
        conversation_id: conversationId,
        thread_id: threadId,
        touched_at: at,
      })
      .onConflict((oc) =>
        oc.columns(["source_id", "conversation_id", "thread_id"]).doUpdateSet({ touched_at: at }),
      )
      .execute();
  },

  expireBefore: (cutoff, at) =>
    db.transaction().execute(async (trx) => {
      const linked = trx.selectFrom("inbox_links").select("item_id");
      const removed = await trx
        .deleteFrom("inbox_items")
        .where("received_at", "<", cutoff)
        .where("id", "not in", linked)
        .executeTakeFirst();
      const expired = await trx
        .updateTable("inbox_items")
        .set({ text: "", permalink: null, expired: 1, updated_at: at })
        .where("received_at", "<", cutoff)
        .where("expired", "=", 0)
        .executeTakeFirst();
      return {
        expired: Number(expired.numUpdatedRows),
        removed: Number(removed.numDeletedRows),
      };
    }),

  forgetThreadsBefore: async (cutoff) => {
    const result = await db
      .deleteFrom("inbox_threads")
      .where("touched_at", "<", cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  },
});

type Builder = ExpressionBuilder<InboxDatabase, "inbox_items">;

const snoozeDue = (eb: Builder, now: string) =>
  eb.and([eb("state", "=", "snoozed"), eb("snoozed_until", "<=", now)]);

/** Still needs the person: not done, and not snoozed into the future. */
const needsMe = (eb: Builder, now: string) =>
  eb.or([eb("state", "in", ["unread", "read"]), snoozeDue(eb, now)]);

const viewFilter = (eb: Builder, view: InboxView, now: string): Expression<SqlBool> => {
  switch (view) {
    case "needs-me":
      return needsMe(eb, now);
    case "mentions":
      return eb.and([
        needsMe(eb, now),
        eb("reason", "in", ["mention", "group", "broadcast", "keyword"]),
      ]);
    case "dms":
      return eb.and([needsMe(eb, now), eb("conversation_kind", "in", ["dm", "group-dm"])]);
    case "threads":
      return eb.and([needsMe(eb, now), eb("thread_id", "is not", null)]);
    case "snoozed":
      return eb.and([eb("state", "=", "snoozed"), eb("snoozed_until", ">", now)]);
    case "done":
      return eb("state", "=", "done");
  }
};
