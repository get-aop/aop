import type { Dispatch, SetStateAction } from "react";
import type { ChatSessionDetail, ChatSessionMessage } from "../../api/client";
import type { DelegationSessionEvent } from "../../components/delegations/delegation-center";
import {
  ingestDelegationSessionEvent,
  markDelegationHostRunTerminal,
  reconcileSessionDelegationsAfterHostFinal,
} from "../../components/delegations/delegation-center";

export type AssistantStreamProgress = {
  thinking: string;
  content: string;
  commandGroups: Array<{
    id: string;
    commands: Array<{
      id: string;
      command: string;
      detail?: string;
      status: "running" | "done" | "failed";
      exitCode?: number | null;
    }>;
  }>;
};

export type WorkflowRunStreamState = import("./composer-types").WorkflowRunViewState;

export type SessionStreamHandlers = {
  activeIdRef: { current: string | null };
  assistantStateGenerationRef?: { current: number };
  skipConnectedReloadRef?: { current: string | null };
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: AssistantStreamProgress | null) => void;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setMidRunHints?: Dispatch<SetStateAction<Record<string, "queued" | "steered">>>;
  setTermLines: Dispatch<SetStateAction<import("@aop/common").TerminalLine[]>>;
  refreshList: () => Promise<unknown>;
  /** Re-fetch full session messages when the server reports an update. */
  reloadDetail?: (sessionId: string) => Promise<unknown>;
  onOpenWorkerDialog?: () => void;
  /** Switch the active session (e.g. after /clear creates a sibling). */
  onOpenSession?: (sessionId: string) => void;
  /** Advance server read cursor while the user is viewing the active session. */
  onMarkSessionRead?: (sessionId: string | null) => Promise<void>;
  /** Live state of the session's chat workflow run (null when idle). */
  setWorkflowRun?: (
    run:
      | import("./composer-types").WorkflowRunViewState
      | null
      | ((
          current: import("./composer-types").WorkflowRunViewState | null,
        ) => import("./composer-types").WorkflowRunViewState | null),
  ) => void;
};

export const handleSessionStreamEvent = (
  event: string,
  data: unknown,
  handlers: SessionStreamHandlers,
): void => {
  const payload = data as Record<string, unknown>;
  // Delegation cards are app-global: forward before the active-session filter.
  if (event === "delegation-updated" || event === "delegation-progress") {
    ingestDelegationSessionEvent(payload as unknown as DelegationSessionEvent);
    return;
  }
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
  if (sessionId && sessionId !== handlers.activeIdRef.current) return;

  switch (event) {
    case "connected":
      reconcileConnectedSession(sessionId, handlers);
      return;
    case "assistant-typing":
      advanceAssistantStateGeneration(handlers);
      clearStartedMessageHint(payload, handlers);
      handlers.setTyping(true);
      handlers.setStreamProgress({ thinking: "", content: "", commandGroups: [] });
      return;
    case "assistant-progress":
      applyAssistantProgress(payload, handlers);
      return;
    case "assistant-final":
      applyAssistantFinal(payload, handlers);
      return;
    case "session-updated":
      applySessionUpdated(sessionId, handlers);
      return;
    case "terminal-line":
      applyTerminalLine(payload, handlers);
      return;
    case "workflow-run-started":
      handlers.setWorkflowRun?.({
        runId: String(payload.runId ?? ""),
        workflowName: String(payload.workflowName ?? "Workflow"),
        stepCount: Number(payload.stepCount ?? 0),
        currentIndex: 0,
        currentStepId: "",
        currentStepType: "",
      });
      return;
    case "workflow-run-step":
      handlers.setWorkflowRun?.((current) =>
        current && current.runId === payload.runId
          ? {
              ...current,
              stepCount: Number(payload.stepCount ?? current.stepCount),
              currentIndex: Number(payload.index ?? current.currentIndex),
              currentStepId: String(payload.stepId ?? current.currentStepId),
              currentStepType: String(payload.stepType ?? current.currentStepType),
            }
          : current,
      );
      return;
    case "workflow-run-completed":
      handlers.setWorkflowRun?.(null);
      return;
  }
};

/**
 * The server claimed a queued message: drop the optimistic hint *and* the stale
 * "queued" disposition still held in the loaded thread. Clearing only the hint
 * left the badge and the composer queue count alive until the next full reload.
 */
const clearStartedMessageHint = (
  payload: Record<string, unknown>,
  handlers: SessionStreamHandlers,
): void => {
  const userMessageId = typeof payload.userMessageId === "string" ? payload.userMessageId : null;
  if (!userMessageId) return;
  handlers.setMidRunHints?.((current) => {
    if (!(userMessageId in current)) return current;
    const next = { ...current };
    delete next[userMessageId];
    return next;
  });
  handlers.setDetail((current) => markMessageStarted(current, userMessageId));
};

const markMessageStarted = (
  current: ChatSessionDetail | null,
  userMessageId: string,
): ChatSessionDetail | null => {
  if (!current) return current;
  const index = current.messages.findIndex((message) => message.id === userMessageId);
  const message = current.messages[index];
  if (!message || message.disposition === "immediate") return current;
  const messages = [...current.messages];
  messages[index] = { ...message, disposition: "immediate" };
  return { ...current, messages };
};

const applySessionUpdated = (sessionId: string | null, handlers: SessionStreamHandlers): void => {
  void handlers.refreshList();
  if (sessionId && handlers.reloadDetail) void handlers.reloadDetail(sessionId);
};

const reconcileConnectedSession = (
  sessionId: string | null,
  handlers: SessionStreamHandlers,
): void => {
  if (!sessionId || !handlers.reloadDetail) return;
  if (handlers.skipConnectedReloadRef?.current === sessionId) {
    handlers.skipConnectedReloadRef.current = null;
    return;
  }
  const generation = handlers.assistantStateGenerationRef?.current;
  void handlers.reloadDetail(sessionId).then((detail) => {
    if (sessionId !== handlers.activeIdRef.current) return;
    if (generation !== handlers.assistantStateGenerationRef?.current) return;
    if (!detail || typeof detail !== "object" || !("assistantActive" in detail)) return;
    if ((detail as { assistantActive: unknown }).assistantActive !== false) {
      handlers.setTyping(true);
      return;
    }
    handlers.setTyping(false);
    handlers.setStreamProgress(null);
  });
};

const applyAssistantProgress = (
  payload: Record<string, unknown>,
  handlers: SessionStreamHandlers,
): void => {
  advanceAssistantStateGeneration(handlers);
  handlers.setTyping(true);
  handlers.setStreamProgress({
    thinking: typeof payload.thinking === "string" ? payload.thinking : "",
    content: typeof payload.content === "string" ? payload.content : "",
    commandGroups: Array.isArray(payload.commandGroups)
      ? (payload.commandGroups as AssistantStreamProgress["commandGroups"])
      : [],
  });
};

const applyAssistantFinalMessage = (
  message: ChatSessionMessage,
  handlers: SessionStreamHandlers,
): void => {
  if (message.runId && message.runStatus) {
    markDelegationHostRunTerminal(message.runId, message.runStatus);
  }
  handlers.setDetail((current) => mergeAssistantMessage(current, message));
  if (message.action?.type === "workerNew") handlers.onOpenWorkerDialog?.();
  if (message.action?.type === "session" && message.action.id) {
    handlers.onOpenSession?.(message.action.id);
  }
};

const refreshListAfterFinal = (handlers: SessionStreamHandlers): void => {
  // Persist the active read cursor before refreshing so a racing list response
  // cannot restore the just-consumed message as unread.
  const markRead = handlers.onMarkSessionRead?.(handlers.activeIdRef.current);
  if (markRead) {
    void markRead.then(() => handlers.refreshList()).catch(() => undefined);
    return;
  }
  void handlers.refreshList();
};

const applyAssistantFinal = (
  payload: Record<string, unknown>,
  handlers: SessionStreamHandlers,
): void => {
  advanceAssistantStateGeneration(handlers);
  handlers.setTyping(false);
  handlers.setStreamProgress(null);
  const message = payload.message as ChatSessionMessage | undefined;
  if (message) applyAssistantFinalMessage(message, handlers);
  // Older events may not carry run metadata. Keep the session-wide fallback so
  // a missed terminal cascade cannot leave the inline specialist row active.
  if (!message?.runId || !message.runStatus) {
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : handlers.activeIdRef.current;
    if (sessionId) reconcileSessionDelegationsAfterHostFinal(sessionId);
  }
  refreshListAfterFinal(handlers);
};

const advanceAssistantStateGeneration = (handlers: SessionStreamHandlers): void => {
  if (handlers.assistantStateGenerationRef) {
    handlers.assistantStateGenerationRef.current += 1;
  }
};

const mergeAssistantMessage = (
  current: ChatSessionDetail | null,
  message: ChatSessionMessage,
): ChatSessionDetail | null => {
  if (!current || current.id !== message.sessionId) return current;
  const existingIndex = current.messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex < 0) return { ...current, messages: [...current.messages, message] };
  const messages = [...current.messages];
  messages[existingIndex] = { ...messages[existingIndex], ...message };
  return { ...current, messages };
};

const applyTerminalLine = (
  payload: Record<string, unknown>,
  handlers: SessionStreamHandlers,
): void => {
  const text = typeof payload.text === "string" ? payload.text : "";
  const tone = payload.tone as import("@aop/common").TerminalLine["tone"] | undefined;
  if (!text || !tone) return;
  handlers.setTermLines((lines) => [...lines, { text, tone }].slice(-80));
};
