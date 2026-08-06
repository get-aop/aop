import { EventEmitter } from "node:events";
import type { ChatDelegationRunDto, TerminalLineTone } from "@aop/common";
import { getTaskEventEmitter } from "../events/task-events.ts";
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
      sessionTitle?: string;
      notifyUnread?: boolean;
    }
  | { type: "session-updated"; sessionId: string; session: ChatSessionDto }
  | {
      type: "terminal-line";
      sessionId: string;
      text: string;
      tone: TerminalLineTone;
    }
  | {
      /** A delegated specialist run changed state (started/active/terminal). */
      type: "delegation-updated";
      sessionId: string;
      hostRunId: string;
      delegation: ChatDelegationRunDto;
    }
  | {
      /** Live output of one delegated specialist, for the expanded card view. */
      type: "delegation-progress";
      sessionId: string;
      delegationId: string;
      /** Suffix delta of the specialist reasoning stream (or full text when `replace`). */
      thinking: string;
      /** Suffix delta of the specialist output text (or full when `replace`). */
      content: string;
      commandGroups: ChatStreamCommandGroup[];
      /** True for replay frames: replace the accumulated client text instead of appending. */
      replace?: boolean;
    }
  | {
      /** A chat-native workflow run started; the composer locks until completion. */
      type: "workflow-run-started";
      sessionId: string;
      runId: string;
      workflowName: string;
      stepCount: number;
    }
  | {
      /** One step of a chat-native workflow run started or finished. */
      type: "workflow-run-step";
      sessionId: string;
      runId: string;
      index: number;
      stepCount: number;
      stepId: string;
      stepType: string;
      status: "started" | "finished";
      resultStatus?: string;
    }
  | {
      /** A chat-native workflow run reached a terminal state; the composer unlocks. */
      type: "workflow-run-completed";
      sessionId: string;
      runId: string;
      status: "done" | "blocked" | "paused" | "failed";
      answer: string;
    };

type Listener = (event: ChatSessionEvent) => void;
type AssistantProgressEvent = Extract<ChatSessionEvent, { type: "assistant-progress" }>;
type DelegationProgressEvent = Extract<ChatSessionEvent, { type: "delegation-progress" }>;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const latestProgressBySession = new Map<string, AssistantProgressEvent>();
const fullProgressBySession = new Map<string, AssistantProgressEvent>();
const latestDelegationProgress = new Map<string, DelegationProgressEvent>();
const fullDelegationProgress = new Map<string, DelegationProgressEvent>();

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

/**
 * Delegation progress mirrors the assistant delta chain: frames carry only the
 * text appended since the previous frame, keyed per delegation, so the wire
 * stays small no matter how long a specialist streams. Clients append deltas
 * and replace their accumulated text on `replace` frames (replay).
 */
export const publishDelegationProgress = (
  sessionId: string,
  delegationId: string,
  progress: { thinking: string; content: string; commandGroups: ChatStreamCommandGroup[] },
): void => {
  const previous = latestDelegationProgress.get(delegationId);
  // A snapshot that is not a strict suffix extension must REPLACE client state
  // (sealed/replayed text reorganization); appending would duplicate the stream.
  const replace =
    previous === undefined ||
    !isCleanDeltaExtension(previous.thinking, progress.thinking) ||
    !isCleanDeltaExtension(previous.content, progress.content);
  const event: DelegationProgressEvent = {
    type: "delegation-progress",
    sessionId,
    delegationId,
    thinking: replace
      ? progress.thinking
      : suffixDelta(previous?.thinking ?? "", progress.thinking),
    content: replace ? progress.content : suffixDelta(previous?.content ?? "", progress.content),
    commandGroups: progress.commandGroups,
    replace,
  };
  latestDelegationProgress.set(delegationId, {
    ...event,
    thinking: progress.thinking,
    content: progress.content,
  });
  fullDelegationProgress.set(delegationId, {
    ...event,
    thinking: progress.thinking,
    content: progress.content,
    replace: true,
  });
  publishChatSessionEvent(event);
};

/** Starts a fresh delta chain (new delegation run). */
export const resetDelegationProgress = (delegationId: string): void => {
  latestDelegationProgress.delete(delegationId);
  fullDelegationProgress.delete(delegationId);
};

/** Replay frames: the full cumulative text per active delegation, flagged so clients replace state. */
export const getLatestDelegationProgressBySession = (
  sessionId: string,
): DelegationProgressEvent[] =>
  [...fullDelegationProgress.values()].filter((event) => event.sessionId === sessionId);

export const publishChatSessionEvent = (event: ChatSessionEvent): void => {
  updateLatestProgress(event);
  emitter.emit(event.sessionId, event);
  if (event.type === "assistant-final" && event.notifyUnread !== false) {
    getTaskEventEmitter().emit({
      type: "chat-unread",
      sessionId: event.sessionId,
      title: event.sessionTitle ?? "Chat session",
      snippet: event.message.content.slice(0, 160),
      kind:
        event.message.action?.label === "Task done"
          ? "task-done"
          : event.message.action?.label === "Task blocked"
            ? "task-blocked"
            : "assistant-final",
    });
  }
};

/** Replay frame: the full cumulative text, flagged so clients replace state. */
export const getLatestChatSessionProgress = (sessionId: string): AssistantProgressEvent | null =>
  fullProgressBySession.get(sessionId) ?? null;

export const subscribeChatSession = (sessionId: string, listener: Listener): (() => void) => {
  emitter.on(sessionId, listener);
  return () => emitter.off(sessionId, listener);
};

/**
 * Same-stream consecutive progress frames coalesce losslessly: deltas
 * concatenate exactly, and a `replace` frame supersedes whatever was queued.
 */
const coalesceConsecutiveProgress = (
  last: ChatSessionEvent | undefined,
  event: ChatSessionEvent,
): ChatSessionEvent | null => {
  if (last?.type !== "assistant-progress" && last?.type !== "delegation-progress") return null;
  const sameStream =
    (event.type === "assistant-progress" && last.type === "assistant-progress") ||
    (event.type === "delegation-progress" &&
      last.type === "delegation-progress" &&
      last.delegationId === event.delegationId);
  if (!sameStream) return null;
  if (event.replace) return event;
  return {
    ...last,
    thinking: last.thinking + event.thinking,
    content: last.content + event.content,
    commandGroups: event.commandGroups,
  };
};

/** Serializes SSE writes while retaining only the newest unsent cumulative progress event. */
export const createChatSessionEventQueue = (
  send: (event: ChatSessionEvent) => Promise<unknown>,
): { push: Listener; clear: () => void } => {
  const queued: ChatSessionEvent[] = [];
  let draining = false;
  let cleared = false;

  const drain = async () => {
    if (draining || cleared) return;
    draining = true;
    try {
      while (!cleared) {
        const event = queued.shift();
        if (!event) return;
        await send(event);
      }
    } finally {
      draining = false;
    }
  };

  return {
    push: (event) => {
      if (cleared) return;
      const merged = coalesceConsecutiveProgress(queued[queued.length - 1], event);
      if (merged) {
        queued[queued.length - 1] = merged;
      } else {
        queued.push(event);
      }
      void drain();
    },
    clear: () => {
      cleared = true;
      queued.length = 0;
    },
  };
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
