import type { Message } from "@aop/common";
import type { LiveProjects } from "../live-projects";
import type { ChatApi } from "./chat-api";
import {
  applyDelta,
  applyMessage,
  applySnapshot,
  type ChatState,
  dropLiveText,
  initialChatState,
  setLoadError,
} from "./chat-state";

/** Which of the coordinator's messages this device has looked at: a per-device choice, as the host keeps no read state for the chat. */
export interface SeenStore {
  get: (projectId: string) => string | null;
  set: (projectId: string, seenAt: string) => void;
}

export interface ProjectChatDeps {
  projectId: string;
  api: Pick<ChatApi, "listMessages" | "sendMessage">;
  events: Pick<LiveProjects, "subscribeEvents" | "subscribe" | "getState">;
  seen: SeenStore;
  /** Runs `run` after `delayMs`; returns what cancels it. */
  schedule?: (run: () => void, delayMs: number) => () => void;
}

/** The chat plus the newest message this device has looked at (an instant), or null before it has seen the project. */
export type ChatModel = ChatState & { seenAt: string | null };

export type SendResult = { ok: true } | { ok: false; error: string };

export interface ProjectChat {
  getState: () => ChatModel;
  subscribe: (listener: () => void) => () => void;
  /** Loads the chat and follows the project's stream until `stop`. */
  start: () => void;
  stop: () => void;
  /** Fetches the chat again: the retry after a failed fetch. */
  reload: () => void;
  send: (text: string) => Promise<SendResult>;
  /** The person is looking at the chat: everything in it counts as seen. */
  markSeen: () => void;
}

export const FETCH_RETRY_MS = 3_000;

const browserSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/**
 * One project's coordinator chat, kept current from three sources that overlap and may arrive
 * in any order: a fetch of the latest messages, the stream's entries and live text, and the
 * message a send returns. Each is applied by message id, so overlap changes nothing.
 *
 * A fetch that starts after a `resync` (and the first one, which starts after the stream is
 * being heard) can only be missing what the stream then delivers; messages that arrive while
 * one is in flight are applied at once and again on top of its result, so the result cannot
 * roll them back. An older fetch is dropped once a newer one starts.
 */
export const createProjectChat = (deps: ProjectChatDeps): ProjectChat => {
  const { projectId, api, events, seen } = deps;
  const schedule = deps.schedule ?? browserSchedule;

  const connectionOf = () => events.getState().byId[projectId]?.connection;

  let model: ChatModel = { ...initialChatState, seenAt: seen.get(projectId) };
  let running = false;
  let generation = 0;
  let fetching = false;
  let arrivedWhileFetching: Message[] = [];
  let connection = connectionOf();
  let cancelRetry: (() => void) | null = null;
  let stopListening: (() => void)[] = [];
  const listeners = new Set<() => void>();

  const publish = (next: ChatModel) => {
    if (next === model) return;
    model = next;
    for (const listener of listeners) listener();
  };
  const update = (step: (state: ChatState) => ChatState) => {
    const next = step(model);
    if (next !== model) publish({ ...model, ...next });
  };

  const receive = (message: Message) => {
    if (fetching) arrivedWhileFetching.push(message);
    update((state) => applyMessage(state, message));
  };

  const onEvent: Parameters<typeof events.subscribeEvents>[1] = (event) => {
    if (event.kind === "resync") void load();
    else if (event.kind === "delta") update((state) => applyDelta(state, event.delta));
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
      const messages = await api.listMessages(projectId);
      if (mine !== generation) return;
      const late = arrivedWhileFetching;
      fetching = false;
      arrivedWhileFetching = [];
      update((state) => late.reduce(applyMessage, applySnapshot(state, messages)));
      settleBaseline();
    } catch (error) {
      if (mine !== generation) return;
      fetching = false;
      arrivedWhileFetching = [];
      update((state) => setLoadError(state, describe(error)));
      cancelRetry = schedule(() => void load(), FETCH_RETRY_MS);
    }
  };

  // The first time a device sees a project, what is already there counts as seen.
  const settleBaseline = () => {
    if (model.seenAt !== null) return;
    markSeenAt(latestInstant(model.messages) ?? new Date(0).toISOString());
  };

  const markSeenAt = (seenAt: string) => {
    if (model.seenAt !== null && Date.parse(seenAt) <= Date.parse(model.seenAt)) return;
    seen.set(projectId, seenAt);
    publish({ ...model, seenAt });
  };

  return {
    getState: () => model,
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
    send: async (text) => {
      try {
        receive(await api.sendMessage(projectId, text));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: describe(error) };
      }
    },
    markSeen: () => {
      const latest = latestInstant(model.messages);
      if (latest) markSeenAt(latest);
    },
  };
};

/** Replies this device has not looked at yet; a thread's report is an event, not something to open the chat for. */
export const unseenCount = ({ messages, seenAt }: ChatModel): number =>
  seenAt === null
    ? 0
    : messages.filter(
        (message) =>
          message.role === "assistant" && Date.parse(message.createdAt) > Date.parse(seenAt),
      ).length;

const latestInstant = (messages: readonly Message[]): string | null =>
  messages.reduce<string | null>(
    (latest, { createdAt }) =>
      latest === null || Date.parse(createdAt) > Date.parse(latest) ? createdAt : latest,
    null,
  );

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Could not reach the host";
