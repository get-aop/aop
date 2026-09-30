import type {
  AssistantMessage,
  EventLogEntry,
  Message,
  MessageBlock,
  MessageDelta,
  ThreadReportMessage,
  UserMessage,
} from "@aop/common";
import type { ProjectStreamEvent } from "../live-projects";
import type { StreamConnection } from "../projects-state";
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

export const delta = (
  messageId: string,
  text: string,
  overrides: Partial<MessageDelta> = {},
): MessageDelta => ({
  projectId: "prj_1",
  threadId: null,
  messageId,
  text,
  replace: false,
  ...overrides,
});

/** The ids of the messages in order, for asserting an order without the noise of the rest. */
export const ids = (messages: readonly Message[]): string[] => messages.map(({ id }) => id);

export const messageEntry = (id: number, message: Message): EventLogEntry => ({
  id,
  projectId: "prj_1",
  type: "message.created",
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
  };
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
    resync: () => send({ kind: "resync", resync: { cursor: 5, reason: "start" } }),
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
