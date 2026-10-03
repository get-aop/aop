import {
  applyLiveOps,
  type LiveSnapshot,
  type Message,
  type MessageDelta,
  type MessagePage,
  type TurnPart,
} from "@aop/common";

/** A reply being written: what its turn has produced so far, and the message it answers. */
export interface LiveTurn {
  parts: readonly TurnPart[];
  inReplyTo?: string;
}

/**
 * One conversation of a project as the page holds it, the coordinator chat or a thread's own:
 * the messages, oldest first, and the live text of a reply still being written. Every step
 * below is a pure function from one state to the next, applied by message id, so a message
 * that arrives twice (from a fetch and from the stream, or from a replay after a reconnect)
 * changes nothing the second time.
 */
export interface ChatState {
  /** The conversation this state holds: a thread's id, or null for the coordinator chat. */
  scope: string | null;
  /** `loading` until the messages have been fetched once. */
  phase: "loading" | "ready";
  /** Why the last fetch failed; the messages held may be behind the host until one succeeds. */
  loadError: string | null;
  messages: readonly Message[];
  /** Whether the host holds messages older than the first one here: the fetch was a page, not the whole. */
  hasEarlier: boolean;
  /** An older page is being fetched. */
  loadingEarlier: boolean;
  /** Why the last fetch of an older page failed. */
  earlierError: string | null;
  /** The replies being written, by the id the finished message will have. */
  live: Readonly<Record<string, LiveTurn>>;
}

export const createChatState = (scope: string | null): ChatState => ({
  scope,
  phase: "loading",
  loadError: null,
  messages: [],
  hasEarlier: false,
  loadingEarlier: false,
  earlierError: null,
  live: {},
});

export const initialChatState: ChatState = createChatState(null);

/**
 * The result of a fetch of the latest page: it replaces the newest messages, and a live text whose
 * message it holds is done. Older pages the person already loaded stay, when the page joins them.
 */
export const applySnapshot = (state: ChatState, page: MessagePage): ChatState => {
  const own = page.messages.filter((message) => message.threadId === state.scope);
  const joinsAt = own[0] ? state.messages.findIndex(({ id }) => id === own[0]?.id) : -1;
  const older = joinsAt > 0 ? state.messages.slice(0, joinsAt) : [];
  return {
    ...state,
    phase: "ready",
    loadError: null,
    messages: older.length > 0 ? [...older, ...own] : own,
    hasEarlier: older.length > 0 ? state.hasEarlier : page.hasMore,
    live: withoutHeld(state.live, own),
  };
};

/** Older messages the host still holds, past the ones fetched: what "Load earlier messages" is about. */
export interface EarlierMessages {
  /** The host holds messages older than the first one held. */
  available: boolean;
  loading: boolean;
  /** Why the last attempt to fetch them failed. */
  error: string | null;
  /** Fetches the next page; resolves once it is in or has failed. */
  load: () => Promise<void>;
}

export const earlierOf = (state: ChatState, load: () => Promise<void>): EarlierMessages => ({
  available: state.hasEarlier,
  loading: state.loadingEarlier,
  error: state.earlierError,
  load,
});

export const startLoadingEarlier = (state: ChatState): ChatState => ({
  ...state,
  loadingEarlier: true,
  earlierError: null,
});

/** An older page goes before the messages held, without repeating any the page and the state share. */
export const applyEarlier = (state: ChatState, page: MessagePage): ChatState => {
  const held = new Set(state.messages.map(({ id }) => id));
  const own = page.messages.filter(
    (message) => message.threadId === state.scope && !held.has(message.id),
  );
  return {
    ...state,
    messages: [...own, ...state.messages],
    hasEarlier: page.hasMore,
    loadingEarlier: false,
    earlierError: null,
  };
};

export const setEarlierError = (state: ChatState, earlierError: string): ChatState => ({
  ...state,
  loadingEarlier: false,
  earlierError,
});

/** An older page that no longer fits (the newest page was fetched again meanwhile) is dropped. */
export const stopLoadingEarlier = (state: ChatState): ChatState => ({
  ...state,
  loadingEarlier: false,
});

export const setLoadError = (state: ChatState, loadError: string): ChatState => ({
  ...state,
  loadError,
});

/** One message from the stream or from sending. The finished message replaces its live text. */
export const applyMessage = (state: ChatState, message: Message): ChatState => {
  if (message.threadId !== state.scope) return state;
  const known = state.messages.findIndex(({ id }) => id === message.id);
  const messages =
    known === -1
      ? insertMessage(state.messages, message)
      : state.messages.map((held, at) => (at === known ? message : held));
  return { ...state, messages, live: withoutKey(state.live, message.id) };
};

/**
 * A message the host changed after it was created, as when a suggested thread is answered. It
 * replaces the copy the page holds. A message the page does not hold is not added: the page
 * holds only the latest of the conversation, and an old message would land at the end.
 */
export const applyMessageUpdate = (state: ChatState, message: Message): ChatState => {
  if (message.threadId !== state.scope) return state;
  const known = state.messages.findIndex(({ id }) => id === message.id);
  if (known === -1) return state;
  return { ...state, messages: state.messages.map((held, at) => (at === known ? message : held)) };
};

/**
 * What changed in a reply being written: text added, a tool call started or finished, reasoning
 * growing. The live parts of a message the page already holds are not shown: deltas and entries
 * travel apart, so a delta can arrive after its message.
 */
export const applyDelta = (state: ChatState, delta: MessageDelta): ChatState => {
  if (delta.threadId !== state.scope) return state;
  if (state.messages.some(({ id }) => id === delta.messageId)) return state;
  const held = state.live[delta.messageId];
  const parts = applyLiveOps(held?.parts ?? [], delta.ops);
  if (!parts?.length) return { ...state, live: withoutKey(state.live, delta.messageId) };
  const inReplyTo = delta.inReplyTo ?? held?.inReplyTo;
  const turn: LiveTurn = { parts, ...(inReplyTo && { inReplyTo }) };
  return { ...state, live: { ...state.live, [delta.messageId]: turn } };
};

/**
 * The turns being written as the connection (re)opened. What the page holds of them stays, so a
 * reply goes on from what was already shown; a turn the snapshot does not name ended while the
 * page could not hear, and its live text goes (its message, if any, came in the replay).
 */
export const applyLiveSnapshot = (state: ChatState, snapshot: LiveSnapshot): ChatState => {
  const turns = snapshot.turns.filter((turn) => turn.threadId === state.scope);
  const running = new Set(turns.map((turn) => turn.messageId));
  const ended = Object.keys(state.live).filter((id) => !running.has(id));
  const kept = ended.reduce((live, id) => withoutKey(live, id), state.live);
  return turns.reduce(applyDelta, kept === state.live ? state : { ...state, live: kept });
};

/** What the person said (or the server said for them) that no reply follows yet. */
export const unansweredMessages = (messages: readonly Message[]): readonly Message[] => {
  const lastReply = messages.findLastIndex(isReply);
  return messages.slice(lastReply + 1).filter(isUserSide);
};

/** Whether the coordinator has something to answer, or is in the middle of answering it. */
export const isWorking = (state: Pick<ChatState, "messages" | "live">): boolean =>
  unansweredMessages(state.messages).length > 0 || Object.keys(state.live).length > 0;

export const isReply = (message: Message): boolean =>
  message.role === "assistant" && steersOf(message) === undefined;

/** A person's message, or a thread's report: the two things that make the coordinator work. */
export const isUserSide = (message: Message): boolean =>
  message.role !== "assistant" && steersOf(message) === undefined;

/**
 * The reply a message was written into while its turn ran. It is part of that reply, drawn
 * inside it, and needs no reply of its own; it is neither a reply nor something left to answer.
 */
export const steersOf = (message: Message): string | undefined =>
  message.role === "user" ? message.steers : undefined;

/**
 * Where a message that is new to the page goes. A reply sits right after the message it says it
 * answers (`inReplyTo`): with thread reports that arrive together, that is the newest of several.
 * Without one, the host runs one turn at a time, oldest message first, so a reply answers the
 * oldest message no reply follows yet and sits right after it. A message sent while the
 * coordinator works comes after the reply it waited for. That is the order a fetch returns, so
 * the chat reads the same before and after a reload.
 */
const insertMessage = (messages: readonly Message[], message: Message): readonly Message[] => {
  const at = isReply(message)
    ? afterAnswered(messages, message)
    : afterLatestNotNewer(messages, message);
  return [...messages.slice(0, at), message, ...messages.slice(at)];
};

const afterAnswered = (messages: readonly Message[], reply: Message): number => {
  const answered =
    reply.role === "assistant" && reply.inReplyTo
      ? messages.findIndex(({ id }) => id === reply.inReplyTo)
      : -1;
  return answered === -1 ? afterOldestUnanswered(messages) : answered + 1;
};

const afterOldestUnanswered = (messages: readonly Message[]): number => {
  const lastReply = messages.findLastIndex(isReply);
  const trigger = messages.findIndex((held, at) => at > lastReply && isUserSide(held));
  return trigger === -1 ? messages.length : trigger + 1;
};

// Messages reach the page in the order the host stored them; only the message a send returns
// can arrive behind one stored after it.
const afterLatestNotNewer = (messages: readonly Message[], message: Message): number => {
  const sentAt = Date.parse(message.createdAt);
  let at = messages.length;
  while (at > 0 && Date.parse((messages[at - 1] as Message).createdAt) > sentAt) at -= 1;
  return at;
};

const withoutKey = (
  live: Readonly<Record<string, LiveTurn>>,
  key: string,
): Readonly<Record<string, LiveTurn>> => {
  if (!(key in live)) return live;
  const { [key]: _done, ...rest } = live;
  return rest;
};

const withoutHeld = (
  live: Readonly<Record<string, LiveTurn>>,
  messages: readonly Message[],
): Readonly<Record<string, LiveTurn>> =>
  messages.reduce((kept, { id }) => withoutKey(kept, id), live);
