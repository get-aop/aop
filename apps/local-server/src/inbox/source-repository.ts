import {
  INBOX_DEFAULT_RULES,
  type InboxNotifyMode,
  InboxNotifyModeSchema,
  type InboxRules,
  InboxRulesSchema,
} from "@aop/common";
import type { Kysely } from "kysely";
import type { InboxDatabase } from "./database.ts";

/**
 * Per connected account: the person's rules, when to notify, and where a catch-up read starts.
 * A row is made the first time any of them is set.
 */
export interface InboxSourceRepository {
  rules: (sourceId: string) => Promise<InboxRules>;
  setRules: (sourceId: string, rules: InboxRules) => Promise<void>;
  notifications: (sourceId: string) => Promise<InboxNotifyMode>;
  setNotifications: (sourceId: string, mode: InboxNotifyMode) => Promise<void>;
  lastSeen: (sourceId: string) => Promise<string | null>;
  /** Moves the mark forward only: an older message read late never moves it back. */
  noteSeen: (sourceId: string, messageId: string) => Promise<void>;
  /** Forgets the account's settings and every item, link, thread and reply it brought. */
  removeSource: (sourceId: string) => Promise<void>;
}

export const createInboxSourceRepository = (
  db: Kysely<InboxDatabase>,
  now: () => Date = () => new Date(),
): InboxSourceRepository => {
  const row = (sourceId: string) =>
    db.selectFrom("inbox_sources").selectAll().where("source_id", "=", sourceId).executeTakeFirst();

  const upsert = async (
    sourceId: string,
    patch: { rules?: string; notifications?: string; last_seen?: string },
  ) => {
    const at = now().toISOString();
    await db
      .insertInto("inbox_sources")
      .values({ source_id: sourceId, ...patch, updated_at: at })
      .onConflict((oc) => oc.column("source_id").doUpdateSet({ ...patch, updated_at: at }))
      .execute();
  };

  return {
    rules: async (sourceId) => {
      const stored = (await row(sourceId))?.rules;
      if (!stored) return INBOX_DEFAULT_RULES;
      const parsed = InboxRulesSchema.safeParse(parseJson(stored));
      return parsed.success ? parsed.data : INBOX_DEFAULT_RULES;
    },
    setRules: (sourceId, rules) => upsert(sourceId, { rules: JSON.stringify(rules) }),
    notifications: async (sourceId) =>
      InboxNotifyModeSchema.catch("off").parse((await row(sourceId))?.notifications ?? "off"),
    setNotifications: (sourceId, mode) => upsert(sourceId, { notifications: mode }),
    lastSeen: async (sourceId) => (await row(sourceId))?.last_seen ?? null,
    noteSeen: async (sourceId, messageId) => {
      const current = (await row(sourceId))?.last_seen ?? null;
      if (current !== null && current >= messageId) return;
      await upsert(sourceId, { last_seen: messageId });
    },
    removeSource: (sourceId) =>
      db.transaction().execute(async (trx) => {
        await trx.deleteFrom("inbox_items").where("source_id", "=", sourceId).execute();
        await trx.deleteFrom("inbox_threads").where("source_id", "=", sourceId).execute();
        await trx.deleteFrom("inbox_sent").where("source_id", "=", sourceId).execute();
        await trx.deleteFrom("inbox_sources").where("source_id", "=", sourceId).execute();
      }),
  };
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
