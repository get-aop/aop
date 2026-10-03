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
  type InboxView,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import type { InboxDatabase } from "./database.ts";
import { decodeCursor, encodeCursor, toInboxItem } from "./item-dto.ts";
import { type IncomingMessage, matchMessage, strongerReason } from "./matcher.ts";
import {
  createInboxRepository,
  type InboxItemRow,
  type InboxLinkRow,
  type InboxRepository,
} from "./repository.ts";

export type InboxError =
  | { code: "NOT_FOUND" }
  | { code: "INVALID_INPUT"; message: string }
  /** No source is connected for the item, so nothing can be read from or sent to it. */
  | { code: "NOT_CONNECTED" }
  /** The source refused or could not be reached; `message` says what to do. */
  | { code: "SOURCE_FAILED"; message: string }
  /** The thread or the coordinator message could not be started. */
  | { code: "DISPATCH_FAILED"; message: string };
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
    page: { cursor?: string; limit?: number; conversations?: readonly string[] },
  ) => Promise<InboxResult<{ page: InboxItemPage }>>;
  get: (id: string) => Promise<InboxResult<{ item: InboxItem }>>;
  setState: (id: string, input: InboxStateInput) => Promise<InboxResult<{ item: InboxItem }>>;
  addLink: (id: string, input: InboxLinkInput) => Promise<InboxResult<{ item: InboxItem }>>;
  removeLink: (id: string, linkId: string) => Promise<InboxResult<{ item: InboxItem }>>;
  /** Links an item; `postBack` is the dispatch dialog's, never a client's link. */
  link: (id: string, input: InboxLinkInput, options?: { postBack?: boolean }) => Promise<void>;
  setPostBack: (
    id: string,
    linkId: string,
    postBack: boolean,
  ) => Promise<InboxResult<{ item: InboxItem }>>;
  unread: () => Promise<number>;
  sweep: () => Promise<InboxSweepReport>;
  isKnownThread: (sourceId: string, conversationId: string, threadId: string) => Promise<boolean>;
  activeThreads: (
    sourceId: string,
    since: string,
  ) => Promise<Array<{ conversationId: string; threadId: string }>>;
  /** The person replied from AOP: the reply is theirs, and the item is answered. */
  noteReply: (item: InboxItem, messageId: string) => Promise<void>;
  sentFrom: (
    sourceId: string,
    conversationId: string,
    messageIds: readonly string[],
  ) => Promise<Set<string>>;
  /** Thread links whose pull request the host still follows. */
  watchedThreadLinks: () => Promise<InboxLinkRow[]>;
  notePullRequest: (link: InboxLinkRow, noted: "opened" | "merged" | "closed") => Promise<void>;
}

export interface InboxServiceDeps {
  db: Kysely<InboxDatabase>;
  /** Days matched messages are kept; 0 keeps them. */
  retentionDays: () => Promise<number>;
  rulesFor?: (sourceId: string) => Promise<InboxRules>;
  /** What each link's thread or pull request is doing now, by link id. */
  linkStatuses?: (links: readonly InboxLinkRow[]) => Promise<Map<string, string | null>>;
  now?: () => Date;
}

const DEFAULT_PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export const createInboxService = (deps: InboxServiceDeps): InboxService => {
  const repository = createInboxRepository(deps.db);
  const now = deps.now ?? (() => new Date());
  const rulesFor = deps.rulesFor ?? (async () => INBOX_DEFAULT_RULES);
  const linkStatuses = deps.linkStatuses ?? (async () => new Map<string, string | null>());

  const withLinks = async (row: InboxItemRow): Promise<InboxItem> => {
    const links = await repository.linksOf([row.id]);
    return toInboxItem(row, links, now().toISOString(), await linkStatuses(links));
  };

  const insertLink = (id: string, input: InboxLinkInput, postBack: boolean) =>
    repository.insertLink({
      id: generateTypeId("inlk"),
      item_id: id,
      kind: input.kind,
      ref: input.ref,
      project_id: input.projectId ?? null,
      title: input.title ?? null,
      url: input.url ?? null,
      post_back: postBack ? 1 : 0,
      pr_noted: null,
      created_at: now().toISOString(),
    });

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
      const rows = await repository.list(view, at, limit + 1, after, page.conversations);
      const shown = rows.slice(0, limit);
      const links = await repository.linksOf(shown.map((row) => row.id));
      const statuses = await linkStatuses(links);
      const last = shown[shown.length - 1];
      return {
        success: true,
        page: {
          items: shown.map((row) => toInboxItem(row, links, at, statuses)),
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
      await insertLink(id, input, false);
      return found(id);
    },

    link: async (id, input, options = {}) => {
      await insertLink(id, input, options.postBack === true);
    },

    setPostBack: async (id, linkId, postBack) =>
      (await repository.updateLink(id, linkId, { post_back: postBack ? 1 : 0 }))
        ? found(id)
        : { success: false, error: { code: "NOT_FOUND" } },

    removeLink: async (id, linkId) =>
      (await repository.deleteLink(id, linkId))
        ? found(id)
        : { success: false, error: { code: "NOT_FOUND" } },

    unread: () => repository.countUnread(now().toISOString()),

    sweep: async () => {
      const days = await deps.retentionDays();
      if (days === 0) return { expired: 0, removed: 0, forgottenThreads: 0 };
      const at = now();
      const cutoff = new Date(at.getTime() - days * DAY_MS).toISOString();
      const items = await repository.expireBefore(cutoff, at.toISOString());
      return { ...items, forgottenThreads: await repository.forgetThreadsBefore(cutoff) };
    },

    isKnownThread: (sourceId, conversationId, threadId) =>
      repository.isKnownThread(sourceId, conversationId, threadId),

    activeThreads: (sourceId, since) => repository.activeThreads(sourceId, since, 50),

    noteReply: async (item, messageId) => {
      const at = now().toISOString();
      await repository.noteSent({
        source_id: item.sourceId,
        conversation_id: item.conversation.id,
        message_id: messageId,
        item_id: item.id,
        sent_at: at,
      });
      // A reply to a channel message starts or joins its thread; one in a DM is just the DM.
      if (item.threadId || item.conversation.kind === "channel") {
        await repository.touchThread(
          item.sourceId,
          item.conversation.id,
          item.threadId ?? item.messageId,
          at,
        );
      }
      if (item.state === "unread") {
        await repository.update(item.id, { state: "read", updated_at: at });
      }
    },

    sentFrom: (sourceId, conversationId, messageIds) =>
      repository.sentFrom(sourceId, conversationId, messageIds),

    watchedThreadLinks: () => repository.watchedThreadLinks(),

    notePullRequest: async (link, noted) => {
      await repository.updateLink(link.item_id, link.id, { pr_noted: noted });
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
