import { EventEmitter } from "node:events";
import type { ChatMessageDto, ChatSessionDto } from "./service.ts";

export interface ChatStreamCommandRow {
  id: string;
  command: string;
  detail?: string;
  status: "running" | "done" | "failed";
  exitCode?: number | null;
}

export interface ChatStreamCommandGroup {
  id: string;
  commands: ChatStreamCommandRow[];
}

export type ChatSessionEvent =
  | { type: "assistant-typing"; sessionId: string; userMessageId: string }
  | {
      type: "assistant-progress";
      sessionId: string;
      /** Suffix delta of the model reasoning stream (or full text when `replace`). */
      thinking: string;
      /** Suffix delta of the assistant status + answer text (or full when `replace`). */
      content: string;
      /** Codex-style command batches for collapsible "Ran N commands". */
      commandGroups: ChatStreamCommandGroup[];
      /** True for replay frames: replace the accumulated client text instead of appending. */
      replace?: boolean;
    }
  | {
      type: "assistant-final";
      sessionId: string;
      message: ChatMessageDto;
    }
  | { type: "session-updated"; sessionId: string; session: ChatSessionDto };

type Listener = (event: ChatSessionEvent) => void;
type AssistantProgressEvent = Extract<ChatSessionEvent, { type: "assistant-progress" }>;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const latestProgressBySession = new Map<string, AssistantProgressEvent>();
const fullProgressBySession = new Map<string, AssistantProgressEvent>();

/**
 * Progress frames carry only the text appended since the previous frame so the
 * wire stays small no matter how long a run streams. Clients append deltas and
 * replace their accumulated text on `replace` frames (replay).
 */
export const publishAssistantProgress = (
  sessionId: string,
  progress: { thinking: string; content: string; commandGroups: ChatStreamCommandGroup[] },
): void => {
  const previous = latestProgressBySession.get(sessionId);
  // A snapshot that is not a strict suffix extension of the previous one
  // (sealed/replayed text reorganization) must REPLACE client state instead of
  // appending — appending a full snapshot duplicates everything streamed so far.
  const replace =
    !isCleanDeltaExtension(previous?.thinking ?? "", progress.thinking) ||
    !isCleanDeltaExtension(previous?.content ?? "", progress.content);
  const event: AssistantProgressEvent = replace
    ? {
        type: "assistant-progress",
        sessionId,
        thinking: progress.thinking,
        content: progress.content,
        commandGroups: progress.commandGroups,
        replace: true,
      }
    : {
        type: "assistant-progress",
        sessionId,
        thinking: suffixDelta(previous?.thinking ?? "", progress.thinking),
        content: suffixDelta(previous?.content ?? "", progress.content),
        commandGroups: progress.commandGroups,
      };
  latestProgressBySession.set(sessionId, {
    ...event,
    thinking: progress.thinking,
    content: progress.content,
  });
  fullProgressBySession.set(sessionId, {
    ...event,
    thinking: progress.thinking,
    content: progress.content,
    replace: true,
  });
  publishChatSessionEvent(event);
};

const isCleanDeltaExtension = (previous: string, next: string): boolean =>
  previous.length === 0 || next.startsWith(previous);

/** Starts a fresh delta chain (new run / new user turn). */
export const resetAssistantProgress = (sessionId: string): void => {
  latestProgressBySession.delete(sessionId);
  fullProgressBySession.delete(sessionId);
};

export const suffixDelta = (previous: string, next: string): string =>
  previous.length > 0 && next.startsWith(previous) ? next.slice(previous.length) : next;

export const publishChatSessionEvent = (event: ChatSessionEvent): void => {
  updateLatestProgress(event);
  emitter.emit(event.sessionId, event);
};

/** Replay frame: the full cumulative text, flagged so clients replace state. */
export const getLatestChatSessionProgress = (sessionId: string): AssistantProgressEvent | null =>
  fullProgressBySession.get(sessionId) ?? null;

export const subscribeChatSession = (sessionId: string, listener: Listener): (() => void) => {
  emitter.on(sessionId, listener);
  return () => emitter.off(sessionId, listener);
};

const updateLatestProgress = (event: ChatSessionEvent): void => {
  // publishAssistantProgress keeps latestProgressBySession at the cumulative
  // text (the delta-chain baseline). Re-storing the delta event here made the
  // next suffixDelta fall back to sending the full text as an append delta,
  // which duplicated the whole thinking/answer on the client every other frame.
  if (event.type === "assistant-typing" || event.type === "assistant-final") {
    latestProgressBySession.delete(event.sessionId);
  }
  if (event.type === "assistant-final") {
    fullProgressBySession.delete(event.sessionId);
  }
};
