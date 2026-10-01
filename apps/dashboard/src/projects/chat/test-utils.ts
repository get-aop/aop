import type {
  AssistantMessage,
  EventLogEntry,
  Message,
  MessageBlock,
  MessageDelta,
  MessagePage,
  ThreadReportMessage,
  UserMessage,
} from "@aop/common";
import type { ProjectStreamEvent } from "../live-projects";
import type { StreamConnection } from "../projects-state";
import type { LiveTurn } from "./chat-state";
import type { SeenStore } from "./project-chat";

const BASE = Date.parse("2026-09-30T10:00:00.000Z");

/** An instant `seconds` after the fixed start of the fixtures, so ids and order read alike. */
export const at = (seconds: number): string => new Date(BASE + seconds * 1000).toISOString();

export const userMessage = (
  id: string,
  seconds: number,
  overrides: Partial<UserMessage> = {},
): UserMessage => ({
  id,
  projectId: "prj_1",
  threadId: null,
  createdAt: at(seconds),
  role: "user",
  text: `message ${id}`,
  ...overrides,
});

export const reply = (
  id: string,
  seconds: number,
  blocks: MessageBlock[] = [{ type: "text", text: `reply ${id}` }],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage => ({
  id,
  projectId: "prj_1",
  threadId: null,
  createdAt: at(seconds),
  role: "assistant",
  blocks,
  ...overrides,
});

export const report = (
  id: string,
  seconds: number,
  overrides: Partial<ThreadReportMessage> = {},
): ThreadReportMessage => ({
  id,
  projectId: "prj_1",
  threadId: null,
  createdAt: at(seconds),
  role: "thread-report",
  reportedThreadId: "thr_1",
  outcome: "finished",
  text: 'Thread report: "Fix login" (thr_1) finished a turn and is now idle.',
  ...overrides,
});

type DeltaOverrides = Partial<Omit<MessageDelta, "ops">>;

/**
 * A reply's first paragraph starting with `text`; with `replace`, the baseline of a turn that is
 * that one paragraph so far, and with `replace` and no text, the end of a turn with no message.
 */
export const delta = (
  messageId: string,
  text: string,
  { replace = false, ...overrides }: DeltaOverrides & { replace?: boolean } = {},
): MessageDelta => ({
  projectId: "prj_1",
  threadId: null,
  messageId,
  ops: !replace
    ? [{ op: "start", index: 0, part: { type: "text", text } }]
    : text
      ? [{ op: "reset", parts: [{ type: "text", text }] }]
      : [{ op: "end" }],
  ...overrides,
});

/** `text` added to the reply's first paragraph. */
export const appended = (
  messageId: string,
  text: string,
  overrides: DeltaOverrides = {},
): MessageDelta => ({
  projectId: "prj_1",
  threadId: null,
  messageId,
  ops: [{ op: "append", index: 0, text }],
  ...overrides,
});

/** A page of messages as the host answers a fetch of them. */
export const page = (messages: readonly Message[], hasMore = false): MessagePage => ({
  messages: [...messages],
  hasMore,
});

/** Answers a fetch from a queue of message lists, in order: the empty page once the queue is used up. */
export const pageFrom = (queue: Promise<Message[]>[]): Promise<MessagePage> =>
  queue.shift()?.then((messages) => page(messages)) ?? Promise.resolve(page([]));

/** The ids of the messages in order, for asserting an order without the noise of the rest. */
export const ids = (messages: readonly Message[]): string[] => messages.map(({ id }) => id);

export const messageEntry = (
  id: number,
  message: Message,
  type: "message.created" | "message.updated" = "message.created",
): EventLogEntry => ({
  id,
  projectId: "prj_1",
  type,
  payload: { message },
});

/** The stream of one project, driven by hand: what the host sent, and whether the connection is up. */
export const createFakeEvents = () => {
  const eventListeners = new Set<(event: ProjectStreamEvent) => void>();
  const stateListeners = new Set<() => void>();
  let connection: StreamConnection = "live";
  const events = {
    getState: () => ({ byId: { prj_1: { connection } } }) as never,
    subscribe: (listener: () => void) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeEvents: (_projectId: string, listener: (event: ProjectStreamEvent) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    liveTurns: (_projectId: string) => liveTurns,
  };
  let liveTurns: MessageDelta[] = [];
  const send = (event: ProjectStreamEvent) => {
    for (const listener of eventListeners) listener(event);
  };
  return {
    events,
    /** Delivers any stream event as it is: for what the helpers below do not build, such as a thread's live text. */
    send,
    listenerCount: () => eventListeners.size + stateListeners.size,
    entry: (id: number, message: Message) =>
      send({ kind: "entry", entry: messageEntry(id, message) }),
    delta: (messageId: string, text: string, replace = false) =>
      send({ kind: "delta", delta: delta(messageId, text, { replace }) }),
    append: (messageId: string, text: string) =>
      send({ kind: "delta", delta: appended(messageId, text) }),
    resync: () => send({ kind: "resync", resync: { cursor: 5, reason: "start" } }),
    /** What the shared stream already holds of turns being written, for a conversation that starts later. */
    setLiveTurns: (turns: MessageDelta[]) => {
      liveTurns = turns;
    },
    /** The snapshot a (re)opened connection sends of the turns being written. */
    live: (...turns: MessageDelta[]) => send({ kind: "live", snapshot: { turns } }),
    setConnection: (next: StreamConnection) => {
      connection = next;
      for (const listener of stateListeners) listener();
    },
  };
};

export const memorySeenStore = (
  initial: Record<string, string> = {},
): SeenStore & { saved: Record<string, string> } => {
  const saved = { ...initial };
  return {
    saved,
    get: (projectId) => saved[projectId] ?? null,
    set: (projectId, seenAt) => {
      saved[projectId] = seenAt;
    },
  };
};

/** A promise a test settles by hand, for the moment a fetch answers. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** The live text of each reply being written, by message id. */
export const liveTexts = (state: { live: Readonly<Record<string, LiveTurn>> }) =>
  Object.fromEntries(
    Object.entries(state.live).map(([id, turn]) => [
      id,
      turn.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    ]),
  );

/** A reply being written, as the chat holds it: one paragraph so far, and the message it answers. */
export const liveTurn = (text: string, inReplyTo?: string): LiveTurn => ({
  parts: [{ type: "text", text }],
  ...(inReplyTo && { inReplyTo }),
});
