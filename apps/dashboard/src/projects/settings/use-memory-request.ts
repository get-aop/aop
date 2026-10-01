import type { Message } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestMemoryChange } from "../../api/memory";
import { useLiveProjects } from "../ProjectsProvider";
import { messageOf } from "./errors";

/** Where a request to the coordinator stands: on its way, being worked on, or answered. */
export type MemoryRequestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "working"; messageId: string }
  | { phase: "answered"; reply: string; failed: boolean }
  | { phase: "refused"; error: string };

export interface MemoryRequest {
  state: MemoryRequestState;
  /** Resolves true when the coordinator took the request. */
  send: (text: string) => Promise<boolean>;
}

/**
 * Sends the person's words to the coordinator and follows its turn on the project's stream: the
 * reply to the request ends the wait, and `onAnswered` runs then, since the coordinator has
 * changed the files by the time it replies.
 */
export const useMemoryRequest = (projectId: string, onAnswered: () => void): MemoryRequest => {
  const live = useLiveProjects();
  const [state, setState] = useState<MemoryRequestState>({ phase: "idle" });
  const answered = useRef(onAnswered);
  answered.current = onAnswered;
  const waitingFor = state.phase === "working" ? state.messageId : null;

  useEffect(() => {
    if (!waitingFor) return;
    return live.subscribeEvents(projectId, (event) => {
      if (event.kind !== "entry" || event.entry.type !== "message.created") return;
      const reply = replyTo(event.entry.payload.message, waitingFor);
      if (!reply) return;
      setState({ phase: "answered", ...reply });
      answered.current();
    });
  }, [live, projectId, waitingFor]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      setState({ phase: "sending" });
      try {
        const message = await requestMemoryChange(projectId, text);
        setState({ phase: "working", messageId: message.id });
        return true;
      } catch (cause) {
        setState({ phase: "refused", error: messageOf(cause, "Could not send the request") });
        return false;
      }
    },
    [projectId],
  );

  return { state, send };
};

/** The reply's text when `message` is the coordinator answering request `messageId`. */
const replyTo = (
  message: Message,
  messageId: string,
): { reply: string; failed: boolean } | null => {
  if (message.role !== "assistant" || message.threadId !== null) return null;
  if (message.inReplyTo !== messageId) return null;
  const reply = message.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  return { reply, failed: message.failed === true };
};
