import type { Message } from "@aop/common";
import type { LiveProjects } from "../live-projects";
import type { ChatApi } from "./chat-api";
import type { ChatState } from "./chat-state";
import { createConversation } from "./conversation";

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
  /** Fetches the page of messages before the oldest one held. */
  loadEarlier: () => Promise<void>;
  /** `images` are ids of images uploaded to the project, in order. */
  send: (text: string, images?: readonly string[]) => Promise<SendResult>;
  /** The person is looking at the chat: everything in it counts as seen. */
  markSeen: () => void;
}

/**
 * One project's coordinator chat: its conversation (see `createConversation`) plus what this
 * device has looked at, and sending.
 */
export const createProjectChat = (deps: ProjectChatDeps): ProjectChat => {
  const { projectId, api, seen } = deps;

  let seenAt = seen.get(projectId);
  let model: ChatModel | null = null;
  let modelChat: ChatState | null = null;
  const seenListeners = new Set<() => void>();

  const conversation = createConversation({
    projectId,
    scope: null,
    listMessages: (before) => api.listMessages(projectId, before),
    events: deps.events,
    schedule: deps.schedule,
    onLoaded: () => settleBaseline(),
  });

  // The model is rebuilt only when the conversation or the seen instant changed, so a store
  // subscriber reads the same object until something did.
  const getState = (): ChatModel => {
    const chat = conversation.getState();
    if (model === null || modelChat !== chat || model.seenAt !== seenAt) {
      model = { ...chat, seenAt };
      modelChat = chat;
    }
    return model;
  };

  // The first time a device sees a project, what is already there counts as seen.
  const settleBaseline = () => {
    if (seenAt !== null) return;
    markSeenAt(latestInstant(conversation.getState().messages) ?? new Date(0).toISOString());
  };

  const markSeenAt = (instant: string) => {
    if (seenAt !== null && Date.parse(instant) <= Date.parse(seenAt)) return;
    seen.set(projectId, instant);
    seenAt = instant;
    for (const listener of seenListeners) listener();
  };

  return {
    getState,
    subscribe: (listener) => {
      seenListeners.add(listener);
      const stopConversation = conversation.subscribe(listener);
      return () => {
        seenListeners.delete(listener);
        stopConversation();
      };
    },
    start: conversation.start,
    stop: conversation.stop,
    reload: conversation.reload,
    loadEarlier: conversation.loadEarlier,
    send: async (text, images) => {
      try {
        conversation.receive(
          await (images?.length
            ? api.sendMessage(projectId, text, images)
            : api.sendMessage(projectId, text)),
        );
        return { ok: true };
      } catch (error) {
        return { ok: false, error: describe(error) };
      }
    },
    markSeen: () => {
      const latest = latestInstant(conversation.getState().messages);
      if (latest) markSeenAt(latest);
    },
  };
};

const latestInstant = (messages: readonly Message[]): string | null =>
  messages.reduce<string | null>(
    (latest, { createdAt }) =>
      latest === null || Date.parse(createdAt) > Date.parse(latest) ? createdAt : latest,
    null,
  );

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Could not reach the host";
