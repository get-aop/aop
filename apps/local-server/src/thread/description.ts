import { THREAD_DESCRIPTION_MAX } from "@aop/common";
import { sql } from "kysely";

/**
 * A thread's description: the start of its first message, which is the brief that started it.
 * The person finds a thread by it when they @-mention one, so it is the words of the ask, on one
 * line, without what the host stores after them (attachment metadata) or around them (a routine's
 * frame).
 */

// Read from the row a little past the limit: whitespace that is folded away may free some room.
const SOURCE_CHARS = THREAD_DESCRIPTION_MAX * 2;

// What `encodeMessageContent` appends after the text of a message that has attachments.
const STORED_METADATA = "\n\n<!--aop-chat-";

/** The first message of the thread a `chat_sessions` row is, as JSON for `descriptionOf`. */
export const firstMessageColumn = sql<string | null>`(
  SELECT json_object('text', substr(first.content, 1, ${sql.lit(SOURCE_CHARS)}), 'origin', first.origin_json)
  FROM chat_messages AS first
  WHERE first.session_id = chat_sessions.id AND first.role = 'user'
  ORDER BY first.created_at, first.id
  LIMIT 1
)`.as("first_message");

/** The thread's `description` field, or nothing while nothing has been said in it. */
export const descriptionOf = (firstMessage: string | null): { description?: string } => {
  if (firstMessage === null) return {};
  const { text, origin } = JSON.parse(firstMessage) as { text: string; origin: string | null };
  const words = oneLine(routinePrompt(origin) ?? withoutMetadata(text));
  if (words === "") return {};
  return {
    description:
      words.length <= THREAD_DESCRIPTION_MAX
        ? words
        : `${words.slice(0, THREAD_DESCRIPTION_MAX - 1)}…`,
  };
};

const withoutMetadata = (text: string): string => {
  const metadata = text.indexOf(STORED_METADATA);
  return metadata < 0 ? text : text.slice(0, metadata);
};

// A routine's brief is stored inside a line naming the run; its origin keeps the routine's words.
const routinePrompt = (origin: string | null): string | null => {
  if (origin === null) return null;
  try {
    const parsed = JSON.parse(origin) as { type?: unknown; prompt?: unknown };
    return parsed.type === "routine" && typeof parsed.prompt === "string" ? parsed.prompt : null;
  } catch {
    return null;
  }
};

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
