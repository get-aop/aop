import type { TerminalLine } from "@aop/common";
import type { Dispatch, SetStateAction } from "react";
import {
  abortChatSession,
  type ChatSessionDetail,
  type ChatSessionSummary,
  getChatSession,
  retryChatRunFresh,
  updateChatSession,
} from "../../api/client";
import { setSessionStreamProgress } from "./session-stream-progress";
import type { MenuState } from "./sessions-menu";
import {
  type AssistantStreamProgress,
  pickSessionAfterSettle,
  runTermCommand,
  storeActiveSessionId,
} from "./sessions-page-helpers";

export const reloadSessionDetailQuiet = async (input: {
  sessionId: string;
  activeIdRef: { current: string | null };
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  clearSessionTyping: (sessionId: string) => void;
}): Promise<ChatSessionDetail | null> => {
  try {
    const session = await getChatSession(input.sessionId);
    if (input.activeIdRef.current !== input.sessionId) return session;
    input.setDetail(session);
    if (session.assistantActive === false) {
      input.clearSessionTyping(input.sessionId);
      setSessionStreamProgress(input.sessionId, null);
    }
    return session;
  } catch {
    return null;
  }
};

export const retrySessionRunFresh = (input: {
  runId: string;
  sessionId?: string;
  showToast: (message: string) => void;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
}): void => {
  if (!input.sessionId) return;
  const confirmed = window.confirm(
    "The previous runtime may already have changed files. Retry the request in a fresh runtime session?",
  );
  if (!confirmed) return;
  const sessionId = input.sessionId;
  void retryChatRunFresh(sessionId, input.runId)
    .then(async () => {
      input.showToast("Retry started in a fresh runtime session");
      await Promise.all([input.reloadDetailQuiet(sessionId), input.refreshList()]);
    })
    .catch((error: unknown) => {
      input.showToast(error instanceof Error ? error.message : "Could not retry run");
    });
};

export const selectSession = async (input: {
  sessionId: string;
  activeId: string | null;
  markSessionRead: (sessionId: string) => unknown;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  setTermLines: Dispatch<SetStateAction<TerminalLine[]>>;
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: AssistantStreamProgress | null) => void;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  loadDetail: (sessionId: string) => Promise<unknown>;
}): Promise<void> => {
  if (input.sessionId === input.activeId) {
    void input.markSessionRead(input.sessionId);
    await input.reloadDetailQuiet(input.sessionId);
    return;
  }
  input.setTermLines([]);
  input.setTyping(false);
  input.setStreamProgress(null);
  input.setMenu({ kind: "closed" });
  input.setDetail(null);
  input.markSessionRead(input.sessionId);
  await input.loadDetail(input.sessionId);
};

export const patchAndReloadSession = async (input: {
  sessionId: string;
  patch: Parameters<typeof updateChatSession>[1];
  activeId: string | null;
  refreshList: () => Promise<ChatSessionSummary[]>;
  loadDetail: (sessionId: string) => Promise<unknown>;
}) => {
  const updated = await updateChatSession(input.sessionId, input.patch);
  await input.refreshList();
  if (input.activeId === input.sessionId) await input.loadDetail(input.sessionId);
  return updated;
};

export const unsettleAndReloadSession = async (input: {
  sessionId: string;
  title: string;
  patchSession: (
    sessionId: string,
    patch: Parameters<typeof updateChatSession>[1],
  ) => Promise<unknown>;
  showToast: (message: string) => void;
}): Promise<void> => {
  try {
    await input.patchSession(input.sessionId, { settledOverride: "active" });
    input.showToast(`Un-settled · ${input.title}`);
  } catch (error) {
    input.showToast(error instanceof Error ? error.message : "Could not un-settle thread");
  }
};

export const removeSessionAndSelectNext = async (input: {
  sessionId: string;
  title: string;
  successVerb: "Settled" | "Deleted";
  failureMessage: string;
  remove: () => Promise<unknown>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  activeIdRef: { current: string | null };
  detailLoadGen: { current: number };
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  loadDetail: (sessionId: string) => Promise<unknown>;
  showToast: (message: string) => void;
}): Promise<void> => {
  try {
    await input.remove();
    const list = await input.refreshList();
    const nextId = pickSessionAfterSettle(list, input.activeIdRef.current, input.sessionId);
    if (input.activeIdRef.current === input.sessionId) {
      input.detailLoadGen.current += 1;
      input.setDetail(null);
      input.setActiveId(nextId);
      input.activeIdRef.current = nextId;
      storeActiveSessionId(nextId);
      input.setDetailLoading(Boolean(nextId));
      if (nextId) await input.loadDetail(nextId);
    }
    input.showToast(`${input.successVerb} · ${input.title}`);
  } catch (error) {
    input.showToast(error instanceof Error ? error.message : input.failureMessage);
  }
};

export const runSessionTerminalCommand = (input: {
  termInput: string;
  sessionId?: string;
  setTermLines: Dispatch<SetStateAction<TerminalLine[]>>;
  setTermInput: Dispatch<SetStateAction<string>>;
  showToast: (message: string) => void;
}): void => {
  if (input.termInput.trim().toLowerCase() === "clear") {
    input.setTermLines([]);
    input.setTermInput("");
    return;
  }
  runTermCommand(input.termInput, input.sessionId, input.setTermInput, input.showToast);
};

export type AbortConversationInput = {
  sessionId: string | null;
  aborting: boolean;
  assistantStateGenerationRef: { current: number };
  setAborting: (value: boolean) => void;
  clearSessionTyping: (sessionId: string) => void;
  clearSessionStreamProgress: (sessionId: string) => void;
  setDetail: (updater: (current: ChatSessionDetail | null) => ChatSessionDetail | null) => void;
  showToast: (message: string) => void;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
};

export const abortActiveConversation = async (input: AbortConversationInput): Promise<void> => {
  if (!input.sessionId || input.aborting) return;
  const sessionId = input.sessionId;
  const generationAtStart = input.assistantStateGenerationRef.current;
  input.setAborting(true);
  try {
    const result = await abortChatSession(sessionId);
    input.assistantStateGenerationRef.current += 1;
    if (!result.aborted) {
      await reconcileInactiveAbort(input, sessionId, generationAtStart);
      return;
    }
    clearLocalAssistantActivity(input, sessionId);
    reportSuccessfulAbort(input, sessionId, result.disposition);
    await input.reloadDetailQuiet(sessionId);
    await input.refreshList();
  } finally {
    input.setAborting(false);
  }
};

export const reconcileInactiveAbort = async (
  input: AbortConversationInput,
  sessionId: string,
  generationAtStart: number,
): Promise<void> => {
  input.showToast("No active conversation to stop");
  const detail = await input.reloadDetailQuiet(sessionId);
  if (input.assistantStateGenerationRef.current !== generationAtStart + 1) return;
  if (detail?.id === sessionId && detail.assistantActive === false) {
    clearLocalAssistantActivity(input, sessionId);
    input.setDetail((current) =>
      current?.id === sessionId ? { ...current, assistantActive: false } : current,
    );
  }
  await input.refreshList();
};

export const clearLocalAssistantActivity = (
  input: AbortConversationInput,
  sessionId: string,
): void => {
  input.clearSessionTyping(sessionId);
  input.clearSessionStreamProgress(sessionId);
};

export const reportSuccessfulAbort = (
  input: AbortConversationInput,
  sessionId: string,
  disposition: Awaited<ReturnType<typeof abortChatSession>>["disposition"],
): void => {
  if (disposition === "durable_cancelled") {
    input.setDetail((current) =>
      current?.id === sessionId
        ? { ...current, assistantActive: false, assistantLifecycle: "idle" }
        : current,
    );
    input.showToast(
      "Stopped tracking the recovered run; its provider process could not be verified",
    );
    return;
  }
  input.showToast(
    disposition === "interrupt_requested" ? "Stop requested" : "Conversation stopped",
  );
};
