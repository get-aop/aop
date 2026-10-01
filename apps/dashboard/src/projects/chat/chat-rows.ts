import type { AssistantMessage, Message } from "@aop/common";
import { type LiveTurn, steersOf, unansweredMessages } from "./chat-state";
import { dayMarkerLabel } from "./chat-time";

export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string }
  /**
   * A message, or a reply still being written (`streaming`), drawn by the same row under the same
   * key: when the reply's message arrives, only the data under the row changes. `steers` are the
   * messages sent into a reply's turn while it ran, which the reply draws, not rows of their own.
   */
  | {
      kind: "message";
      key: string;
      message: Message;
      streaming: boolean;
      steers?: readonly Message[];
    }
  /** The agent at work, and since when: the message it is answering. */
  | { kind: "working"; key: string; since: string | null };

export interface RowsInput {
  messages: readonly Message[];
  /** Replies being written, by the id their message will have. */
  live: Readonly<Record<string, LiveTurn>>;
  /** Whether the coordinator is expected to be working: the project is active and something awaits an answer. */
  working: boolean;
  /** The first message this device had not seen when the chat was opened. */
  firstNewId: string | null;
  /** How many of the latest messages to show. */
  window: number;
  now?: Date;
}

const END = "";

/**
 * The chat as a list of rows: messages under their day, a "New" line before what arrived while
 * the person was away, each reply being written right after the message it answers, where its
 * message will take its place, and, while the agent works, a line saying so below them.
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
  const shown = messages.slice(start);
  const trigger = unansweredMessages(messages)[0] ?? null;
  const replies = liveRepliesByAnchor(shown, live, trigger);
  const steered = steeredByReply(shown, live);
  const inside = new Set([...steered.values()].flat().map(({ id }) => id));
  const withSteers = (row: ChatRow): ChatRow => {
    if (row.kind !== "message") return row;
    const steers = steered.get(row.key);
    return steers ? { ...row, steers } : row;
  };
  const rows: ChatRow[] = [];
  let previous: Message | null = null;

  for (const message of shown) {
    if (inside.has(message.id)) continue;
    rows.push(...rowsOf(message, previous, firstNewId, now).map(withSteers));
    rows.push(...(replies.get(message.id) ?? []).map(withSteers));
    previous = message;
  }
  rows.push(...(replies.get(END) ?? []).map(withSteers));
  if (working) insertWorkingRow(rows, shown, trigger, live);
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
  rows.push({ kind: "message", key: message.id, message, streaming: false });
  return rows;
};

/**
 * The messages each reply on screen draws inside it: the ones its turn took in (its `steer`
 * parts), and the ones sent into it that it has not taken yet (`steers`). A message whose reply
 * is not on screen is drawn on its own, where it was sent.
 */
const steeredByReply = (
  shown: readonly Message[],
  live: Readonly<Record<string, LiveTurn>>,
): Map<string, Message[]> => {
  const byId = new Map(shown.map((message) => [message.id, message]));
  const onScreen = new Set([...byId.keys(), ...Object.keys(live)]);
  const pairs: Array<[replyId: string, messageId: string]> = [
    ...shown.flatMap((message) =>
      message.role === "assistant" ? takenIn(message.id, message.blocks) : [],
    ),
    ...Object.entries(live).flatMap(([id, turn]) => takenIn(id, turn.parts)),
    ...shown.flatMap((message): Array<[string, string]> => {
      const reply = steersOf(message);
      return reply && onScreen.has(reply) ? [[reply, message.id]] : [];
    }),
  ];
  const replies = new Map<string, Message[]>();
  for (const [replyId, messageId] of pairs) {
    const message = byId.get(messageId);
    const held = replies.get(replyId) ?? [];
    if (message && !held.includes(message)) replies.set(replyId, [...held, message]);
  }
  return replies;
};

// The messages a reply's turn took in, in the order it took them.
const takenIn = (
  replyId: string,
  blocks: readonly { type: string; messageId?: string }[],
): Array<[string, string]> =>
  blocks.flatMap((block) =>
    block.type === "steer" && block.messageId
      ? [[replyId, block.messageId] as [string, string]]
      : [],
  );

// A reply sits after the message it says it answers; without one, after the oldest message no
// reply follows yet, which is the one the host answers first (see chat-state.ts). A reply whose
// message is not on screen goes last.
const liveRepliesByAnchor = (
  shown: readonly Message[],
  live: Readonly<Record<string, LiveTurn>>,
  trigger: Message | null,
): Map<string, ChatRow[]> => {
  const byAnchor = new Map<string, ChatRow[]>();
  const onScreen = new Map(shown.map((message) => [message.id, message]));
  const fallback = trigger && onScreen.has(trigger.id) ? trigger : undefined;
  for (const [id, turn] of Object.entries(live)) {
    if (turn.parts.length === 0) continue;
    const anchor = (turn.inReplyTo && onScreen.get(turn.inReplyTo)) || fallback;
    const key = anchor?.id ?? END;
    const row: ChatRow = {
      kind: "message",
      key: id,
      message: liveReply(id, turn, anchor, shown[0]),
      streaming: true,
    };
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), row]);
  }
  return byAnchor;
};

// The reply as the message it will be: its parts so far, in the conversation of the messages around it.
const liveReply = (
  id: string,
  turn: LiveTurn,
  anchor: Message | undefined,
  neighbour: Message | undefined,
): AssistantMessage => ({
  id,
  role: "assistant",
  projectId: neighbour?.projectId ?? "",
  threadId: neighbour?.threadId ?? null,
  createdAt: anchor?.createdAt ?? "",
  blocks: [...turn.parts],
  ...(turn.inReplyTo && { inReplyTo: turn.inReplyTo }),
});

// Below the reply being written; with none yet, below the message being answered.
const insertWorkingRow = (
  rows: ChatRow[],
  shown: readonly Message[],
  trigger: Message | null,
  live: Readonly<Record<string, LiveTurn>>,
): void => {
  const lastReply = rows.findLastIndex((row) => row.kind === "message" && row.streaming);
  const triggerAt = trigger ? rows.findIndex((row) => row.key === trigger.id) : -1;
  const at = lastReply !== -1 ? lastReply + 1 : triggerAt !== -1 ? triggerAt + 1 : rows.length;
  const answering =
    (lastReply !== -1 ? replyAnchor(rows[lastReply], shown, live) : undefined) ?? trigger;
  rows.splice(at, 0, { kind: "working", key: "working", since: answering?.createdAt ?? null });
};

const replyAnchor = (
  row: ChatRow | undefined,
  shown: readonly Message[],
  live: Readonly<Record<string, LiveTurn>>,
): Message | undefined => {
  const inReplyTo = row ? live[row.key]?.inReplyTo : undefined;
  return shown.find(({ id }) => id === inReplyTo);
};
