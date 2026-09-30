import type { Message } from "@aop/common";
import { createContext, useContext } from "react";

/**
 * Where each thread is shown in full in a conversation. A thread has one card and one report
 * line, the newest ones; earlier mentions would only say what the thread was back then, so a
 * thread never stands in the conversation as two cards or two reports that disagree.
 */
export interface ThreadPresence {
  /** Thread id -> the newest assistant message that carries a card for it. */
  cardMessage: ReadonlyMap<string, string>;
  /** Thread id -> the newest report message about it. */
  latestReport: ReadonlyMap<string, string>;
}

const NONE: ThreadPresence = { cardMessage: new Map(), latestReport: new Map() };

export const presenceOf = (messages: readonly Message[]): ThreadPresence => {
  const cardMessage = new Map<string, string>();
  const latestReport = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "thread-report") latestReport.set(message.reportedThreadId, message.id);
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type === "thread-card") cardMessage.set(block.threadId, message.id);
    }
  }
  return { cardMessage, latestReport };
};

export const ThreadPresenceContext = createContext<ThreadPresence>(NONE);

export const useThreadPresence = (): ThreadPresence => useContext(ThreadPresenceContext);
