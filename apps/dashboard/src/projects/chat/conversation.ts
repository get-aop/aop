import type { Message, MessagePage } from "@aop/common";
import type { LiveProjects } from "../live-projects";
import {
  applyDelta,
  applyEarlier,
  applyMessage,
  applyMessageUpdate,
  applySnapshot,
  type ChatState,
  createChatState,
  dropLiveText,
  setEarlierError,
  setLoadError,
  startLoadingEarlier,
  stopLoadingEarlier,
} from "./chat-state";

export interface ConversationDeps {
  projectId: string;
  /** The conversation to follow: a thread's id, or null for the coordinator chat. */
  scope: string | null;
  /** The latest page of messages, or the one before message `before`. */
  listMessages: (before?: string) => Promise<MessagePage>;
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
  /** Fetches the page of messages before the oldest one held; resolves once it is in or has failed. */
  loadEarlier: () => Promise<void>;
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
 * id, so overlap changes nothing. A message the host publishes again (`message.updated`)
 * replaces the copy held.
 *
 * The host answers a fetch with a page of the newest messages; older ones are fetched on
 * request, by the oldest message held, and stay when the newest page is fetched again.
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
  let arrivedWhileFetching: ((current: ChatState) => ChatState)[] = [];
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

  // A change to the messages is applied at once, and again on top of a fetch that is in flight.
  const hear = (step: (current: ChatState) => ChatState) => {
    if (fetching) arrivedWhileFetching.push(step);
    update(step);
  };

  const receive = (message: Message) => hear((current) => applyMessage(current, message));

  const onEvent: Parameters<typeof events.subscribeEvents>[1] = (event) => {
    if (event.kind === "resync") void load();
    else if (event.kind === "delta") update((current) => applyDelta(current, event.delta));
    else if (event.entry.type === "message.created") receive(event.entry.payload.message);
    else if (event.entry.type === "message.updated") {
      const { message } = event.entry.payload;
      hear((current) => applyMessageUpdate(current, message));
    }
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
      const page = await deps.listMessages();
      if (mine !== generation) return;
      const late = arrivedWhileFetching;
      fetching = false;
      arrivedWhileFetching = [];
      update((current) => late.reduce((next, step) => step(next), applySnapshot(current, page)));
      deps.onLoaded?.(state);
    } catch (error) {
      if (mine !== generation) return;
      fetching = false;
      arrivedWhileFetching = [];
      update((current) => setLoadError(current, describe(error)));
      cancelRetry = schedule(() => void load(), FETCH_RETRY_MS);
    }
  };

  const loadEarlier = async (): Promise<void> => {
    const oldest = state.messages[0];
    if (!oldest || !state.hasEarlier || state.loadingEarlier) return;
    update(startLoadingEarlier);
    try {
      const page = await deps.listMessages(oldest.id);
      // The messages are append-only, so the page stays right unless the newest page was fetched
      // again meanwhile and left a different oldest message: then it would not join them.
      update((current) =>
        current.messages[0]?.id === oldest.id
          ? applyEarlier(current, page)
          : stopLoadingEarlier(current),
      );
    } catch (error) {
      update((current) => setEarlierError(current, describe(error)));
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
    loadEarlier,
    receive,
  };
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Could not reach the host";
