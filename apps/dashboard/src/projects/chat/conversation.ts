import type { Message } from "@aop/common";
import type { LiveProjects } from "../live-projects";
import {
  applyDelta,
  applyMessage,
  applySnapshot,
  type ChatState,
  createChatState,
  dropLiveText,
  setLoadError,
} from "./chat-state";

export interface ConversationDeps {
  projectId: string;
  /** The conversation to follow: a thread's id, or null for the coordinator chat. */
  scope: string | null;
  listMessages: () => Promise<Message[]>;
  events: Pick<LiveProjects, "subscribeEvents" | "subscribe" | "getState">;
  /** Runs `run` after `delayMs`; returns what cancels it. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  /** Called after every fetch that succeeded, with the state it produced. */
  onLoaded?: (state: ChatState) => void;
}

export interface Conversation {
  getState: () => ChatState;
  subscribe: (listener: () => void) => () => void;
  /** Loads the conversation and follows the project's stream until `stop`. */
  start: () => void;
  stop: () => void;
  /** Fetches the conversation again: the retry after a failed fetch. */
  reload: () => void;
  /** A message this page just caused (the answer to a send); the stream repeats it harmlessly. */
  receive: (message: Message) => void;
}

export const FETCH_RETRY_MS = 3_000;

const browserSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/**
 * One conversation of a project (the coordinator chat, or a thread's own), kept current from
 * three sources that overlap and may arrive in any order: a fetch of the latest messages, the
 * stream's entries and live text, and the message a send returns. Each is applied by message
 * id, so overlap changes nothing.
 *
 * A fetch that starts after a `resync` (and the first one, which starts after the stream is
 * being heard) can only be missing what the stream then delivers; messages that arrive while
 * one is in flight are applied at once and again on top of its result, so the result cannot
 * roll them back. An older fetch is dropped once a newer one starts.
 */
export const createConversation = (deps: ConversationDeps): Conversation => {
  const { projectId, scope, events } = deps;
  const schedule = deps.schedule ?? browserSchedule;

  const connectionOf = () => events.getState().byId[projectId]?.connection;

  let state = createChatState(scope);
  let running = false;
  let generation = 0;
  let fetching = false;
  let arrivedWhileFetching: Message[] = [];
  let connection = connectionOf();
  let cancelRetry: (() => void) | null = null;
  let stopListening: (() => void)[] = [];
  const listeners = new Set<() => void>();

  const update = (step: (current: ChatState) => ChatState) => {
    const next = step(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const receive = (message: Message) => {
    if (fetching) arrivedWhileFetching.push(message);
    update((current) => applyMessage(current, message));
  };

  const onEvent: Parameters<typeof events.subscribeEvents>[1] = (event) => {
    if (event.kind === "resync") void load();
    else if (event.kind === "delta") update((current) => applyDelta(current, event.delta));
    else if (event.entry.type === "message.created") receive(event.entry.payload.message);
  };

  // A dropped connection ends the baseline of every running reply; the reconnect sends new ones.
  const onConnection = () => {
    const now = connectionOf();
    if (now === connection) return;
    connection = now;
    if (now === "reconnecting") update(dropLiveText);
  };

  const load = async (): Promise<void> => {
    const mine = ++generation;
    fetching = true;
    arrivedWhileFetching = [];
    cancelRetry?.();
    cancelRetry = null;
    try {
      const messages = await deps.listMessages();
      if (mine !== generation) return;
      const late = arrivedWhileFetching;
      fetching = false;
      arrivedWhileFetching = [];
      update((current) => late.reduce(applyMessage, applySnapshot(current, messages)));
      deps.onLoaded?.(state);
    } catch (error) {
      if (mine !== generation) return;
      fetching = false;
      arrivedWhileFetching = [];
      update((current) => setLoadError(current, describe(error)));
      cancelRetry = schedule(() => void load(), FETCH_RETRY_MS);
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      if (running) return;
      running = true;
      connection = connectionOf();
      stopListening = [events.subscribeEvents(projectId, onEvent), events.subscribe(onConnection)];
      void load();
    },
    stop: () => {
      running = false;
      generation += 1;
      fetching = false;
      arrivedWhileFetching = [];
      cancelRetry?.();
      cancelRetry = null;
      for (const stop of stopListening) stop();
      stopListening = [];
    },
    reload: () => {
      if (running) void load();
    },
    receive,
  };
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Could not reach the host";
