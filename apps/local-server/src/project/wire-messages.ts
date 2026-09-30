import { type Message, type MessageBlock, MessageBlockSchema, MessageSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { z } from "zod";
import { decodeMessageContent, expandStoredPastes } from "../chat-session/message-images.ts";
import { type MessageOrigin, parseMessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatMessage, ChatSession, Database } from "../db/schema.ts";
import { createSuggestionRepository, type MessageAnswers } from "../suggestion/repository.ts";
import { textToBlocks } from "./text-blocks.ts";

export const DEFAULT_MESSAGE_PAGE_SIZE = 200;

/** Where a session's messages sit on the wire: the coordinator chat has no thread id. */
export interface MessageScope {
  projectId: string;
  threadId: string | null;
}

/**
 * A project session's messages as clients see them, oldest first, at most the latest `limit`.
 * An assistant message is its text followed by the blocks its run's tools produced, with the
 * answers to its suggested threads filled in. A message with nothing to show (an image-only
 * prompt) is left out, since the wire types need content.
 */
export const listWireMessages = async (
  db: Kysely<Database>,
  session: ChatSession,
  limit = DEFAULT_MESSAGE_PAGE_SIZE,
): Promise<Message[]> => {
  const rows = await messagesWithRunBlocks(db, session)
    .orderBy("chat_messages.turn_index", "desc")
    .orderBy("chat_messages.created_at", "desc")
    .orderBy("chat_messages.id", "desc")
    .limit(limit)
    .execute();
  const answers = await createSuggestionRepository(db).listForMessages(rows.map(({ id }) => id));
  const scope = scopeOf(session);
  return rows.reverse().flatMap((row) => {
    const message = toWireMessage(scope, row, parseBlocks(row.run_blocks), answers.get(row.id));
    return message ? [message] : [];
  });
};

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
  return toWireMessage(scopeOf(session), row, parseBlocks(row.run_blocks), answers.get(row.id));
};

/** Null when the message has no text or blocks to show. */
export const toWireMessage = (
  scope: MessageScope,
  row: ChatMessage,
  runBlocks: readonly MessageBlock[] = [],
  answers?: MessageAnswers,
): Message | null => {
  const base = {
    id: row.id,
    projectId: scope.projectId,
    threadId: scope.threadId,
    createdAt: row.created_at,
  };
  const text = displayText(row);
  if (row.role === "assistant") {
    // Only the coordinator refers to threads by link; a thread's own text is shown as written.
    const written =
      scope.threadId === null ? textToBlocks(text) : text ? [{ type: "text", text }] : [];
    const blocks = [...written, ...withAnswers(runBlocks, answers)];
    return blocks.length === 0 ? null : MessageSchema.parse({ ...base, role: "assistant", blocks });
  }
  if (!text) return null;
  const origin = parseMessageOrigin(row.origin_json);
  // The server's nudge to resume after a rate limit is plumbing: the reply that explains the
  // wait is already in the transcript.
  if (origin?.type === "rate-limit-resume") return null;
  return MessageSchema.parse(userSideMessage(base, text, origin));
};

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
      return { ...base, role: "user", text };
  }
};

/** What a stored message says, as a person reads it: attachments' markers and pasted text expanded. */
export const displayText = (row: Pick<ChatMessage, "content" | "session_id">): string => {
  const decoded = decodeMessageContent(row.content, row.session_id);
  return expandStoredPastes(decoded.text, decoded.pastes).trim();
};

// A session's messages, each with the blocks of the run that wrote it.
const messagesWithRunBlocks = (db: Kysely<Database>, session: ChatSession) =>
  db
    .selectFrom("chat_messages")
    .leftJoin("chat_runs", "chat_runs.assistant_message_id", "chat_messages.id")
    .selectAll("chat_messages")
    .select("chat_runs.blocks_json as run_blocks")
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
