import {
  InboxConversationKindSchema,
  type InboxItem,
  InboxLinkKindSchema,
  InboxReasonSchema,
  InboxStateSchema,
} from "@aop/common";
import type { InboxItemRow, InboxLinkRow, ListCursor } from "./repository.ts";

/**
 * An item as the API shows it, with its links. A snoozed item whose time has come reads as
 * unread, so no job has to wake it.
 */
export const toInboxItem = (
  row: InboxItemRow,
  links: readonly InboxLinkRow[],
  now: string,
  statuses: ReadonlyMap<string, string | null> = new Map(),
): InboxItem => {
  const due = row.state === "snoozed" && row.snoozed_until !== null && row.snoozed_until <= now;
  return {
    id: row.id,
    sourceId: row.source_id,
    conversation: {
      id: row.conversation_id,
      name: row.conversation_name,
      kind: InboxConversationKindSchema.catch("channel").parse(row.conversation_kind),
    },
    threadId: row.thread_id,
    messageId: row.message_id,
    author: { id: row.author_id, name: row.author_name, avatarUrl: row.author_avatar_url },
    text: row.text,
    reason: InboxReasonSchema.catch("mention").parse(row.reason),
    messageCount: row.message_count,
    state: due ? "unread" : InboxStateSchema.catch("unread").parse(row.state),
    snoozedUntil: due ? null : row.snoozed_until,
    permalink: row.permalink,
    deleted: row.deleted === 1,
    expired: row.expired === 1,
    receivedAt: row.received_at,
    links: links
      .filter((link) => link.item_id === row.id)
      .map((link) => ({
        id: link.id,
        kind: InboxLinkKindSchema.catch("thread").parse(link.kind),
        ref: link.ref,
        projectId: link.project_id,
        title: link.title,
        url: link.url,
        status: statuses.get(link.id) ?? null,
        postBack: link.post_back === 1,
        createdAt: link.created_at,
      })),
  };
};

/** Opaque to clients: the last item's time and id, so a page starts right after it. */
export const encodeCursor = (row: Pick<InboxItemRow, "received_at" | "id">): string =>
  Buffer.from(JSON.stringify([row.received_at, row.id])).toString("base64url");

export const decodeCursor = (cursor: string): ListCursor | null => {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    ) {
      return { receivedAt: value[0], id: value[1] };
    }
  } catch {
    // Not one of ours.
  }
  return null;
};
