import {
  INBOX_DEFAULT_RULES,
  INBOX_LIMITS,
  type InboxItem,
  type InboxItemPage,
  type InboxLinkInput,
  type InboxReason,
  InboxReasonSchema,
  type InboxRules,
  type InboxStateInput,
  type InboxSummary,
  type InboxView,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import type { InboxDatabase } from "./database.ts";
import { decodeCursor, encodeCursor, toInboxItem } from "./item-dto.ts";
import { type IncomingMessage, matchMessage, strongerReason } from "./matcher.ts";
import { createInboxRepository, type InboxItemRow, type InboxRepository } from "./repository.ts";

export type InboxError = { code: "NOT_FOUND" } | { code: "INVALID_INPUT"; message: string };
export type InboxResult<T> = ({ success: true } & T) | { success: false; error: InboxError };

export interface InboxSweepReport {
  /** Linked items past retention, kept without their text. */
  expired: number;
  /** Items past retention that nothing linked to. */
  removed: number;
  /** Threads the person was part of, quiet for longer than the retention. */
  forgottenThreads: number;
}

export interface InboxService {
  /** Keeps a message when it needs the person, gathered into its conversation's or thread's item. */
  ingest: (message: IncomingMessage) => Promise<InboxItem | null>;
  /** A message changed at its source: the item showing it shows the new text. */
  edit: (
    sourceId: string,
    conversationId: string,
    messageId: string,
    text: string,
  ) => Promise<void>;
  /** A message was deleted at its source: the item showing it drops its text. */
  remove: (sourceId: string, conversationId: string, messageId: string) => Promise<void>;
  list: (
    view: InboxView,
    page: { cursor?: string; limit?: number },
  ) => Promise<InboxResult<{ page: InboxItemPage }>>;
  get: (id: string) => Promise<InboxResult<{ item: InboxItem }>>;
  setState: (id: string, input: InboxStateInput) => Promise<InboxResult<{ item: InboxItem }>>;
  addLink: (id: string, input: InboxLinkInput) => Promise<InboxResult<{ item: InboxItem }>>;
  removeLink: (id: string, linkId: string) => Promise<InboxResult<{ item: InboxItem }>>;
  summary: () => Promise<InboxSummary>;
  sweep: () => Promise<InboxSweepReport>;
}

export interface InboxServiceDeps {
  db: Kysely<InboxDatabase>;
  /** Days matched messages are kept; 0 keeps them. */
  retentionDays: () => Promise<number>;
  rulesFor?: (sourceId: string) => Promise<InboxRules>;
  now?: () => Date;
}

const DEFAULT_PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export const createInboxService = (deps: InboxServiceDeps): InboxService => {
  const repository = createInboxRepository(deps.db);
  const now = deps.now ?? (() => new Date());
  const rulesFor = deps.rulesFor ?? (async () => INBOX_DEFAULT_RULES);

  const withLinks = async (row: InboxItemRow): Promise<InboxItem> =>
    toInboxItem(row, await repository.linksOf([row.id]), now().toISOString());

  const itemOf = async (id: string): Promise<InboxItem | null> => {
    const row = await repository.get(id);
    return row ? withLinks(row) : null;
  };

  const found = async (id: string): Promise<InboxResult<{ item: InboxItem }>> => {
    const item = await itemOf(id);
    return item ? { success: true, item } : { success: false, error: { code: "NOT_FOUND" } };
  };

  return {
    ingest: async (message) => {
      const at = now().toISOString();
      const inMyThread = await joinThread(repository, message, at);
      const existing = await repository.findByKey(message.sourceId, itemKey(message));
      if (message.fromMe) {
        // The person answered in Slack: what they answered no longer waits on them.
        if (existing?.state === "unread") {
          await repository.update(existing.id, { state: "read", updated_at: at });
        }
        return null;
      }
      const reason = matchMessage(message, await rulesFor(message.sourceId), inMyThread);
      if (!reason) return null;
      const id = existing
        ? await gather(repository, existing, message, reason, at)
        : await create(repository, message, reason, at);
      return itemOf(id);
    },

    edit: async (sourceId, conversationId, messageId, text) => {
      const row = await repository.findByMessage(sourceId, conversationId, messageId);
      if (!row || row.expired || row.deleted) return;
      await repository.update(row.id, { text, updated_at: now().toISOString() });
    },

    remove: async (sourceId, conversationId, messageId) => {
      const row = await repository.findByMessage(sourceId, conversationId, messageId);
      if (!row) return;
      await repository.update(row.id, { text: "", deleted: 1, updated_at: now().toISOString() });
    },

    list: async (view, page) => {
      const after = page.cursor ? decodeCursor(page.cursor) : null;
      if (page.cursor && !after) {
        return { success: false, error: { code: "INVALID_INPUT", message: "Unknown cursor" } };
      }
      const limit = Math.min(Math.max(page.limit ?? DEFAULT_PAGE, 1), INBOX_LIMITS.pageMax);
      const at = now().toISOString();
      // One more than asked tells whether there is a next page without a count.
      const rows = await repository.list(view, at, limit + 1, after);
      const shown = rows.slice(0, limit);
      const links = await repository.linksOf(shown.map((row) => row.id));
      const last = shown[shown.length - 1];
      return {
        success: true,
        page: {
          items: shown.map((row) => toInboxItem(row, links, at)),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        },
      };
    },

    get: found,

    setState: async (id, input) => {
      if (!(await repository.get(id))) return { success: false, error: { code: "NOT_FOUND" } };
      await repository.update(id, {
        state: input.state,
        snoozed_until: input.state === "snoozed" ? new Date(input.until).toISOString() : null,
        updated_at: now().toISOString(),
      });
      return found(id);
    },

    addLink: async (id, input) => {
      if (!(await repository.get(id))) return { success: false, error: { code: "NOT_FOUND" } };
      await repository.insertLink({
        id: generateTypeId("inlk"),
        item_id: id,
        kind: input.kind,
        ref: input.ref,
        project_id: input.projectId ?? null,
        title: input.title ?? null,
        url: input.url ?? null,
        created_at: now().toISOString(),
      });
      return found(id);
    },

    removeLink: async (id, linkId) =>
      (await repository.deleteLink(id, linkId))
        ? found(id)
        : { success: false, error: { code: "NOT_FOUND" } },

    summary: async () => ({ unread: await repository.countUnread(now().toISOString()) }),

    sweep: async () => {
      const days = await deps.retentionDays();
      if (days === 0) return { expired: 0, removed: 0, forgottenThreads: 0 };
      const at = now();
      const cutoff = new Date(at.getTime() - days * DAY_MS).toISOString();
      const items = await repository.expireBefore(cutoff, at.toISOString());
      return { ...items, forgottenThreads: await repository.forgetThreadsBefore(cutoff) };
    },
  };
};

/**
 * One item per DM conversation, per thread, or per lone channel message. A channel message that
 * mentions the person and the replies that later make it a thread share a key, since a reply's
 * thread id is its first message's id.
 */
export const itemKey = (message: IncomingMessage): string => {
  const conversation = message.conversation.id;
  if (message.threadId) return `${conversation}:${message.threadId}`;
  if (message.conversation.kind !== "channel") return conversation;
  return `${conversation}:${message.messageId}`;
};

/**
 * Notes the threads the person is part of (one they posted in or were mentioned in) and keeps
 * them fresh while they are active. Returns whether the message is a reply in such a thread.
 */
const joinThread = async (
  repository: InboxRepository,
  message: IncomingMessage,
  at: string,
): Promise<boolean> => {
  const { sourceId, conversation, threadId } = message;
  const inMyThread =
    threadId !== null && (await repository.isKnownThread(sourceId, conversation.id, threadId));
  if (inMyThread || message.fromMe || message.mentionsMe) {
    await repository.touchThread(sourceId, conversation.id, threadId ?? message.messageId, at);
  }
  return inMyThread;
};

const create = async (
  repository: InboxRepository,
  message: IncomingMessage,
  reason: InboxReason,
  at: string,
): Promise<string> => {
  const id = generateTypeId("inbx");
  await repository.insert({
    id,
    ...messageColumns(message),
    reason,
    created_at: at,
    updated_at: at,
  });
  return id;
};

/**
 * Adds a message to its item, which shows it and needs the person again, even when done or
 * snoozed. A redelivered or older message (a catch-up read after a restart) changes nothing.
 */
const gather = async (
  repository: InboxRepository,
  existing: InboxItemRow,
  message: IncomingMessage,
  reason: InboxReason,
  at: string,
): Promise<string> => {
  if (existing.message_id === message.messageId || message.sentAt < existing.received_at) {
    return existing.id;
  }
  await repository.update(existing.id, {
    ...messageColumns(message),
    reason: strongerReason(InboxReasonSchema.catch(reason).parse(existing.reason), reason),
    message_count: existing.message_count + 1,
    state: "unread",
    snoozed_until: null,
    deleted: 0,
    expired: 0,
    updated_at: at,
  });
  return existing.id;
};

const messageColumns = (message: IncomingMessage) => ({
  source_id: message.sourceId,
  item_key: itemKey(message),
  conversation_id: message.conversation.id,
  conversation_name: message.conversation.name,
  conversation_kind: message.conversation.kind,
  thread_id: message.threadId,
  message_id: message.messageId,
  author_id: message.author.id,
  author_name: message.author.name,
  author_avatar_url: message.author.avatarUrl,
  text: message.text,
  permalink: message.permalink,
  received_at: message.sentAt,
});
