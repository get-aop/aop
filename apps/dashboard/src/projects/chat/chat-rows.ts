import type { Message } from "@aop/common";
import { unansweredMessages } from "./chat-state";
import { dayMarkerLabel } from "./chat-time";

export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string }
  | { kind: "message"; key: string; message: Message }
  /** The coordinator at work on the oldest message no reply follows yet, and what it has written so far. */
  | { kind: "activity"; key: string; liveText: string; since: string | null };

export interface RowsInput {
  messages: readonly Message[];
  /** Live text of replies being written, by message id. */
  live: Readonly<Record<string, string>>;
  /** Whether the coordinator is expected to be working: the project is active and something awaits an answer. */
  working: boolean;
  /** The first message this device had not seen when the chat was opened. */
  firstNewId: string | null;
  /** How many of the latest messages to show. */
  window: number;
  now?: Date;
}

/**
 * The chat as a list of rows: messages under their day, a "New" line before what arrived while
 * the person was away, and, while the coordinator works, its live text right after the message
 * it is answering, where the finished reply will take its place.
 */
export const buildRows = ({
  messages,
  live,
  working,
  firstNewId,
  window,
  now,
}: RowsInput): { rows: ChatRow[]; hidden: number } => {
  const start = Math.max(0, messages.length - window);
  const trigger = working ? (unansweredMessages(messages)[0] ?? null) : null;
  const liveText = Object.values(live).join("\n\n");
  const rows: ChatRow[] = [];
  let previous: Message | null = null;

  for (const message of messages.slice(start)) {
    rows.push(...rowsOf(message, previous, firstNewId, now));
    if (trigger?.id === message.id) rows.push(activityRow(message.createdAt, liveText));
    previous = message;
  }
  // Live text with no message on screen that it answers (it came before the chat was loaded).
  if (working && !rows.some(({ kind }) => kind === "activity")) {
    rows.push(activityRow(null, liveText));
  }
  return { rows, hidden: start };
};

/** One message with the day line and the New line that belong right above it. */
const rowsOf = (
  message: Message,
  previous: Message | null,
  firstNewId: string | null,
  now: Date | undefined,
): ChatRow[] => {
  const rows: ChatRow[] = [];
  const day = dayMarkerLabel(message.createdAt, previous?.createdAt ?? null, now);
  if (day) rows.push({ kind: "day", key: `day:${message.id}`, label: day });
  if (message.id === firstNewId) rows.push({ kind: "new", key: "new" });
  rows.push({ kind: "message", key: message.id, message });
  return rows;
};

const activityRow = (since: string | null, liveText: string): ChatRow => ({
  kind: "activity",
  key: "activity",
  liveText,
  since,
});
