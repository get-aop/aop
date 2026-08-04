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
      /** Cumulative model reasoning / thought stream (e.g. Grok `thought` tokens). */
      thinking: string;
      /** Cumulative assistant status + answer text (intermediate runs stacked). */
      content: string;
      /** Codex-style command batches for collapsible "Ran N commands". */
      commandGroups: ChatStreamCommandGroup[];
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
      thinking: string;
      content: string;
      commandGroups: ChatStreamCommandGroup[];
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

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const latestProgressBySession = new Map<string, AssistantProgressEvent>();

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

export const getLatestChatSessionProgress = (sessionId: string): AssistantProgressEvent | null =>
  latestProgressBySession.get(sessionId) ?? null;

export const subscribeChatSession = (sessionId: string, listener: Listener): (() => void) => {
  emitter.on(sessionId, listener);
  return () => emitter.off(sessionId, listener);
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
      const last = queued[queued.length - 1];
      if (event.type === "assistant-progress" && last?.type === "assistant-progress") {
        queued[queued.length - 1] = event;
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
  if (event.type === "assistant-progress") {
    latestProgressBySession.set(event.sessionId, event);
    return;
  }
  if (event.type === "assistant-typing" || event.type === "assistant-final") {
    latestProgressBySession.delete(event.sessionId);
  }
};
