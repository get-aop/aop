import type { Dispatch, SetStateAction } from "react";
import {
  type ChatSessionAction,
  type ChatSessionDetail,
  type ChatSessionSummary,
  getAgents,
  resetChatSessionRuntime,
  runChatSessionTerminal,
  type updateChatSession,
} from "../../api/client";
import { requestConfirmation } from "../../components/ConfirmationHost";
import type { Agent } from "../../types";
import { isSessionSettled } from "./session-settled";

export const IDLE_RESET_RUNTIME_MESSAGE = "The next message will start a fresh runtime session.";
export const ACTIVE_RESET_RUNTIME_MESSAGE =
  "This will stop the current run and start fresh on the next message.";
export const RESET_RUNTIME_SUCCESS_TOAST = "Runtime session reset";

const isQueuedDisposition = (value: string | undefined): boolean =>
  value === "queued" || value === "steered";

/** Count user messages waiting to run after the active reply (scoped to this session). */
export const countQueuedSessionMessages = (
  messages: ChatSessionDetail["messages"],
  midRunHints: Record<string, "queued" | "steered">,
): number => {
  const sessionMessageIds = new Set(messages.map((message) => message.id));
  const claimed = new Set(
    messages
      .filter((message) => message.disposition && !isQueuedDisposition(message.disposition))
      .map((message) => message.id),
  );
  const ids = new Set(
    messages
      .filter((message) => message.role === "user" && isQueuedDisposition(message.disposition))
      .map((message) => message.id),
  );
  // Hints are page-global and optimistic; only count IDs that belong to this
  // session and that the server has not already claimed for a run.
  for (const [id, hint] of Object.entries(midRunHints)) {
    if (sessionMessageIds.has(id) && !claimed.has(id) && isQueuedDisposition(hint)) ids.add(id);
  }
  return ids.size;
};

/** Keep only mid-run hints that belong to messages in the active session thread. */
export const scopeMidRunHintsToMessages = (
  messages: ChatSessionDetail["messages"],
  midRunHints: Record<string, "queued" | "steered">,
): Record<string, "queued" | "steered"> => {
  const sessionMessageIds = new Set(messages.map((message) => message.id));
  const scoped: Record<string, "queued" | "steered"> = {};
  for (const [id, hint] of Object.entries(midRunHints)) {
    if (sessionMessageIds.has(id)) scoped[id] = hint;
  }
  return scoped;
};

type ResetRuntimeDeps = {
  requestConfirmation: typeof requestConfirmation;
  resetChatSessionRuntime: typeof resetChatSessionRuntime;
};

/** Confirm, call reset-runtime API, then refresh/toast. Does not mutate local state on failure. */
export const confirmAndResetRuntimeSession = async (
  input: {
    sessionId: string;
    activeRun: boolean;
    isActiveSession: () => boolean;
    refreshList: () => Promise<ChatSessionSummary[]>;
    reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null | undefined>;
    showToast: (message: string) => void;
  },
  deps: ResetRuntimeDeps = {
    requestConfirmation,
    resetChatSessionRuntime,
  },
): Promise<void> => {
  const confirmed = await deps.requestConfirmation({
    title: "Reset runtime session?",
    message: input.activeRun ? ACTIVE_RESET_RUNTIME_MESSAGE : IDLE_RESET_RUNTIME_MESSAGE,
    confirmLabel: "Reset",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await deps.resetChatSessionRuntime(input.sessionId);
    await input.refreshList();
    if (input.isActiveSession()) await input.reloadDetailQuiet(input.sessionId);
    input.showToast(RESET_RUNTIME_SUCCESS_TOAST);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reset runtime session";
    input.showToast(message);
  }
};

const ACTIVE_SESSION_STORAGE_KEY = "aop.sessions.activeId";

export const readStoredActiveSessionId = (): string | null => {
  try {
    return sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const storeActiveSessionId = (sessionId: string | null): void => {
  try {
    if (!sessionId) {
      sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Private mode / disabled storage — selection still works for this mount.
  }
};

/** Prefer the last opened session; otherwise newest non-settled (list order). */
export const pickSessionToOpen = (
  list: ChatSessionSummary[],
  preferredId?: string | null,
  now = new Date().toISOString(),
): string | null => {
  if (preferredId && list.some((session) => session.id === preferredId)) {
    return preferredId;
  }
  return (list.find((session) => !isSessionSettled(session, { now })) ?? list[0])?.id ?? null;
};

export const pickSessionAfterSettle = (
  list: ChatSessionSummary[],
  activeSessionId: string | null,
  settledSessionId = activeSessionId,
  now = new Date().toISOString(),
): string | null => {
  if (activeSessionId !== settledSessionId) return activeSessionId;
  return list.find((session) => !isSessionSettled(session, { now }))?.id ?? null;
};

export const bootstrapSessions = async (
  refreshList: () => Promise<ChatSessionSummary[]>,
  loadDetail: (id: string) => Promise<ChatSessionDetail | null>,
  setAgents: (agents: Agent[]) => void,
  preferredSessionId?: string | null,
): Promise<void> => {
  try {
    setAgents(await getAgents());
  } catch {
    setAgents([]);
  }
  const list = await refreshList();
  const openId = pickSessionToOpen(list, preferredSessionId ?? readStoredActiveSessionId());
  if (openId) await loadDetail(openId);
};

export const navigateFromAction = (
  action: ChatSessionAction,
  onNavigate: (path: string) => void,
  onOpenWorkerDialog: (() => void) | undefined,
  showToast: (message: string) => void,
  /** When set, missing/stale task ids fall back to Pool (concept goRef contract). */
  knownTaskIds?: readonly string[],
  onOpenSession?: (sessionId: string) => void,
): void => {
  switch (action.type) {
    case "task":
      navigateTaskAction(action, onNavigate, showToast, knownTaskIds);
      return;
    case "pool":
      onNavigate("/pool");
      return;
    case "workflows":
      onNavigate(action.id ? `/workflows/${encodeURIComponent(action.id)}` : "/workflows");
      return;
    case "review":
      onNavigate("/pool");
      showToast("Review items are shown in Pool");
      return;
    case "workerNew":
      onOpenWorkerDialog?.();
      return;
    case "session":
      if (action.id) onOpenSession?.(action.id);
      return;
  }
};

const navigateTaskAction = (
  action: ChatSessionAction,
  onNavigate: (path: string) => void,
  showToast: (message: string) => void,
  knownTaskIds?: readonly string[],
): void => {
  if (action.id && (!knownTaskIds || knownTaskIds.includes(action.id))) {
    onNavigate(`/tasks/${encodeURIComponent(action.id)}`);
    return;
  }
  onNavigate("/pool");
  showToast("Task moved — showing Pool");
};
export const runTermCommand = (
  termInput: string,
  sessionId: string | undefined,
  setTermInput: (value: string) => void,
  showToast: (message: string) => void,
): void => {
  const cmd = termInput.trim();
  if (!cmd) return;
  if (cmd.toLowerCase() === "clear") {
    // Caller clears local lines via setTermLines before invoking, or we signal via toast only.
    setTermInput("");
    return;
  }
  setTermInput("");
  if (!sessionId) return;
  // Output streams over SSE; HTTP response is optional confirmation. Errors surface as meta.
  void runChatSessionTerminal(sessionId, cmd).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Terminal command failed";
    showToast(message);
  });
};

/** Pin/unpin with immediate rail update and restore+toast on failure. */
export const pinSessionOptimistic = async (input: {
  sessionId: string;
  pinned: boolean;
  sessions: ChatSessionSummary[];
  setSessions?: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  patchSession: (
    sessionId: string,
    patch: Parameters<typeof updateChatSession>[1],
  ) => Promise<ChatSessionSummary>;
  showToast: (message: string) => void;
}): Promise<void> => {
  const previous = input.sessions;
  const optimistic = previous.map((session) =>
    session.id === input.sessionId ? { ...session, pinned: input.pinned } : session,
  );
  input.setSessions?.(optimistic);
  try {
    await input.patchSession(input.sessionId, { pinned: input.pinned });
  } catch (error) {
    input.setSessions?.(previous);
    const message = error instanceof Error ? error.message : "Could not update pin state";
    input.showToast(message);
  }
};

export * from "./sessions-page-helpers-menu";
export * from "./sessions-page-helpers-stream";
