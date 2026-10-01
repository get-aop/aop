import {
  CHAT_IMAGE_LIMITS,
  type Message,
  type MessageBlock,
  MessageBlockSchema,
  type MessageImage,
  type MessagePage,
  MessageSchema,
} from "@aop/common";
import type { Kysely } from "kysely";
import { z } from "zod";
import { messageImagePath } from "../attachment/service.ts";
import {
  decodeMessageContent,
  decodeStoredAttachmentMetadata,
  expandStoredPastes,
} from "../chat-session/message-images.ts";
import { type MessageOrigin, parseMessageOrigin } from "../chat-session/message-origin.ts";
import { storedTurnParts } from "../chat-session/turn-parts.ts";
import type { ChatMessage, ChatSession, Database } from "../db/schema.ts";
import { createSuggestionRepository, type MessageAnswers } from "../suggestion/repository.ts";

export const DEFAULT_MESSAGE_PAGE_SIZE = 200;
export const MAX_MESSAGE_PAGE_SIZE = 500;
export const UNKNOWN_PAGE_ANCHOR =
  "There is no such message in this conversation to list the ones before";

/** Which page of a session's messages a client asks for; none is the latest page. */
export interface MessagePageRequest {
  /** The oldest message the client holds: the page is what came before it. */
  before?: string;
  limit?: number;
}

/** Where a session's messages sit on the wire: the coordinator chat has no thread id. */
export interface MessageScope {
  projectId: string;
  threadId: string | null;
}

/** What a message needs beyond its row: the answers to its suggested threads, whether its run failed, and what it answers. */
export interface MessageExtras {
  answers?: MessageAnswers;
  failed?: boolean;
  /** For a reply: the message its run answered. */
  inReplyTo?: string;
  /** For a user message written into a running turn: the reply that turn writes. */
  steers?: string;
}

/**
 * A page of a project session's messages as clients see them, oldest first: the latest `limit`,
 * or the `limit` before message `before`, and whether older ones remain. Null when `before` is
 * not a message of the session. An assistant message is its text followed by the blocks its
 * run's tools produced, with the answers to its suggested threads filled in. A message with
 * nothing to show (an image-only prompt) is left out, since the wire types need content.
 */
export const listWireMessages = async (
  db: Kysely<Database>,
  session: ChatSession,
  request: MessagePageRequest = {},
): Promise<MessagePage | null> => {
  const anchor = request.before ? await findAnchor(db, session.id, request.before) : undefined;
  return anchor === null
    ? null
    : readPage(db, session, request.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, anchor);
};

interface Anchor {
  id: string;
  turn_index: number;
  created_at: string;
}

const readPage = async (
  db: Kysely<Database>,
  session: ChatSession,
  limit: number,
  anchor: Anchor | undefined,
): Promise<MessagePage> => {
  const inSession = messagesWithRunBlocks(db, session);
  // Strictly before the anchor in the order below, which is the order of the whole conversation.
  const rows = await (anchor
    ? inSession.where((eb) =>
        eb.or([
          eb("chat_messages.turn_index", "<", anchor.turn_index),
          eb.and([
            eb("chat_messages.turn_index", "=", anchor.turn_index),
            eb("chat_messages.created_at", "<", anchor.created_at),
          ]),
          eb.and([
            eb("chat_messages.turn_index", "=", anchor.turn_index),
            eb("chat_messages.created_at", "=", anchor.created_at),
            eb("chat_messages.id", "<", anchor.id),
          ]),
        ]),
      )
    : inSession
  )
    .orderBy("chat_messages.turn_index", "desc")
    .orderBy("chat_messages.created_at", "desc")
    .orderBy("chat_messages.id", "desc")
    .limit(limit + 1)
    .execute();
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  const answers = await createSuggestionRepository(db).listForMessages(page.map(({ id }) => id));
  const scope = scopeOf(session);
  const messages = page.reverse().flatMap((row) => {
    const message = toWireMessage(scope, row, parseBlocks(row.run_blocks), {
      answers: answers.get(row.id),
      failed: isFailedRun(row.run_status, row.run_failure_kind),
      inReplyTo: row.run_user_message_id ?? undefined,
      steers: row.steered_reply_id ?? undefined,
    });
    return message ? [message] : [];
  });
  const hasMore = rows.length > limit;
  // A page of rows with nothing to show gives the client no message to page back from: go on past it.
  return messages.length === 0 && hasMore && oldest
    ? readPage(db, session, limit, oldest)
    : { messages, hasMore };
};

/** A run that ended in failure. One a usage limit refused is a wait, not a fault, and reads as a reply. */
export const isFailedRun = (status: string | null, failureKind: string | null | undefined) =>
  status === "failed" && failureKind !== "rate_limit";

const findAnchor = async (db: Kysely<Database>, sessionId: string, messageId: string) =>
  (await db
    .selectFrom("chat_messages")
    .select(["id", "turn_index", "created_at"])
    .where("session_id", "=", sessionId)
    .where("id", "=", messageId)
    .executeTakeFirst()) ?? null;

/** One message of a project session as clients see it now; null when it is gone or has nothing to show. */
export const getWireMessage = async (
  db: Kysely<Database>,
  session: ChatSession,
  messageId: string,
): Promise<Message | null> => {
  const row = await messagesWithRunBlocks(db, session)
    .where("chat_messages.id", "=", messageId)
    .executeTakeFirst();
  if (!row) return null;
  const answers = await createSuggestionRepository(db).listForMessages([row.id]);
  return toWireMessage(scopeOf(session), row, parseBlocks(row.run_blocks), {
    answers: answers.get(row.id),
    failed: isFailedRun(row.run_status, row.run_failure_kind),
    inReplyTo: row.run_user_message_id ?? undefined,
    steers: row.steered_reply_id ?? undefined,
  });
};

/** Null when the message has no text or blocks to show. */
export const toWireMessage = (
  scope: MessageScope,
  row: ChatMessage,
  runBlocks: readonly MessageBlock[] = [],
  extras: MessageExtras = {},
): Message | null => {
  const base = {
    id: row.id,
    projectId: scope.projectId,
    threadId: scope.threadId,
    createdAt: row.created_at,
  };
  const text = displayText(row);
  const origin = parseMessageOrigin(row.origin_json);
  if (row.role === "assistant") {
    const blocks = [...withAnswers(runBlocks, extras.answers), ...welcomeCard(origin)];
    return assistantMessage(base, [...storedTurnParts(row, text), ...blocks], extras);
  }
  // Only the person's own words carry images; a report or a relay never does.
  const images = origin ? [] : messageImages(scope.projectId, row);
  if (!text && images.length === 0) return null;
  // The server's nudge to resume after a rate limit is plumbing: the reply that explains the
  // wait is already in the transcript.
  if (origin?.type === "rate-limit-resume") return null;
  const steers = extras.steers && origin?.type !== "thread-report" ? { steers: extras.steers } : {};
  return MessageSchema.parse({ ...userSideMessage(base, text, origin, images), ...steers });
};

// A stored image of a type the wire does not know (none is accepted today) is left out rather
// than making the whole conversation unreadable.
const messageImages = (projectId: string, row: Pick<ChatMessage, "content">): MessageImage[] =>
  decodeStoredAttachmentMetadata(row.content).images.flatMap((image) =>
    (CHAT_IMAGE_LIMITS.allowedMimeTypes as readonly string[]).includes(image.mimeType)
      ? [
          {
            id: image.id,
            mimeType: image.mimeType,
            path: messageImagePath(projectId, image.fileName),
          },
        ]
      : [],
  );

// A reply is the parts its turn produced, in order, then the blocks its tools posted.
const assistantMessage = (
  base: { id: string; projectId: string; threadId: string | null; createdAt: string },
  blocks: readonly MessageBlock[],
  { failed = false, inReplyTo }: MessageExtras,
): Message | null =>
  blocks.length === 0
    ? null
    : MessageSchema.parse({
        ...base,
        role: "assistant",
        blocks,
        ...(failed && { failed }),
        ...(inReplyTo && { inReplyTo }),
      });

// The host's welcome on a new project has no run to carry blocks: the survey it started is its card.
const welcomeCard = (origin: MessageOrigin | null): MessageBlock[] =>
  origin?.type === "kickoff-welcome" && origin.surveyThreadId
    ? [{ type: "thread-card", threadId: origin.surveyThreadId, variant: "live" }]
    : [];

export const scopeOf = (session: ChatSession): MessageScope => {
  if (!session.project_id) throw new Error(`Session ${session.id} belongs to no project`);
  return {
    projectId: session.project_id,
    threadId: session.kind === "thread" ? session.id : null,
  };
};

// A user-role row is the person's words, unless an origin says the server or the coordinator
// wrote it: a report (shown as an event line) or a brief relayed into a thread.
const userSideMessage = (
  base: { id: string; projectId: string; threadId: string | null; createdAt: string },
  text: string,
  origin: MessageOrigin | null,
  images: MessageImage[],
) => {
  switch (origin?.type) {
    case "thread-report":
      return {
        ...base,
        role: "thread-report",
        reportedThreadId: origin.threadId,
        outcome: origin.outcome,
        text,
      };
    case "coordinator-relay":
      return {
        ...base,
        role: "assistant",
        blocks: [
          ...(origin.quote ? [{ type: "quote-forwarded", text: origin.quote }] : []),
          { type: "text", text },
        ],
      };
    default:
      return {
        ...base,
        role: "user",
        text: shownUserText(text, origin),
        ...(images.length > 0 && { images }),
      };
  }
};

/** What the chat shows for a person's message: their own words, not the frame the server put around them. */
export const shownUserText = (content: string, origin?: MessageOrigin | null): string =>
  origin?.type === "memory-request" ? origin.request : content;

/** What a stored message says, as a person reads it: attachments' markers and pasted text expanded. */
export const displayText = (row: Pick<ChatMessage, "content" | "session_id">): string => {
  const decoded = decodeMessageContent(row.content, row.session_id);
  return expandStoredPastes(decoded.text, decoded.pastes).trim();
};

// A session's messages, each with the blocks of the run that wrote it and how that run ended.
const messagesWithRunBlocks = (db: Kysely<Database>, session: ChatSession) =>
  db
    .selectFrom("chat_messages")
    .leftJoin("chat_runs", "chat_runs.assistant_message_id", "chat_messages.id")
    .leftJoin("chat_runs as steered_run", "steered_run.id", "chat_messages.steered_run_id")
    .selectAll("chat_messages")
    .select([
      "chat_runs.blocks_json as run_blocks",
      "chat_runs.status as run_status",
      "chat_runs.failure_kind as run_failure_kind",
      "chat_runs.user_message_id as run_user_message_id",
      "steered_run.assistant_message_id as steered_reply_id",
    ])
    .where("chat_messages.session_id", "=", session.id);

// A run stores its proposals as the coordinator made them. The answers live in their own table
// and are put on the proposals whenever a message is sent.
const withAnswers = (
  blocks: readonly MessageBlock[],
  answers: MessageAnswers | undefined,
): MessageBlock[] =>
  blocks.map((block) =>
    block.type === "suggested-threads" && answers
      ? {
          ...block,
          suggestions: block.suggestions.map((suggestion) => {
            const answer = answers.get(suggestion.id);
            return answer ? { ...suggestion, answer } : suggestion;
          }),
        }
      : block,
  );

// A block an earlier build stored in a shape this one no longer reads (a receipt that only
// counted threads, say) is left out, so one old block cannot make the whole conversation unreadable.
const parseBlocks = (raw: string | null): MessageBlock[] =>
  raw === null
    ? []
    : z
        .array(z.unknown())
        .parse(JSON.parse(raw))
        .flatMap((block) => {
          const parsed = MessageBlockSchema.safeParse(block);
          return parsed.success ? [parsed.data] : [];
        });
