import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import {
  type ChatSessionDetail,
  type ChatSessionSummary,
  createChatSession,
  deleteChatSession,
  updateChatSession,
} from "../../api/client";
import type { SessionToastLink } from "./SessionModals";
import { type StreamProgressUpdate, setSessionStreamProgress } from "./session-stream-progress";
import type { MenuState } from "./sessions-menu";
import { confirmAndResetRuntimeSession } from "./sessions-page-helpers";
import {
  abortActiveConversation,
  openResolvedMarkdownFromChat,
  patchAndReloadSession,
  removeSessionAndSelectNext,
  retrySessionRunFresh,
  selectSession,
  unsettleAndReloadSession,
} from "./sessions-page-internals";
import type { useSessionComposer } from "./use-session-composer";
import { clearSessionUnreadCount } from "./use-session-unread-counts";

export interface SessionsPageActionsInput {
  active: ChatSessionDetail | null;
  activeId: string | null;
  activeIdRef: MutableRefObject<string | null>;
  detailLoadGen: MutableRefObject<number>;
  aborting: boolean;
  assistantStateGenerationRef: MutableRefObject<number>;
  setAborting: Dispatch<SetStateAction<boolean>>;
  composer: ReturnType<typeof useSessionComposer>;
  markSessionRead: (sessionId: string) => void;
  loadDetail: (sessionId: string) => Promise<ChatSessionDetail | null>;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  clearSessionTyping: (sessionId: string) => void;
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: StreamProgressUpdate) => void;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>;
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>;
  showToast: (message: string, link?: SessionToastLink) => void;
  openSessionById: (sessionId: string) => Promise<void>;
}

/** Thread/workspace action handlers (select, settle, delete, abort…). */
export const useSessionsPageActions = (input: SessionsPageActionsInput) => {
  const {
    active,
    activeId,
    activeIdRef,
    detailLoadGen,
    composer,
    markSessionRead,
    loadDetail,
    reloadDetailQuiet,
    refreshList,
    setDetail,
    setSessions,
    setMenu,
    showToast,
  } = input;

  const handleOpenChatFile = useCallback(
    (path: string) =>
      openResolvedMarkdownFromChat(
        path,
        active?.workspacePath ?? null,
        input.setDiffPanelOpen,
        input.setMdPanel,
      ),
    [active?.workspacePath, input.setDiffPanelOpen, input.setMdPanel],
  );

  const openCreatedSession = async (session: ChatSessionSummary) => {
    await refreshList();
    await loadDetail(session.id);
    void markSessionRead(session.id);
    setSessions((current) => clearSessionUnreadCount(current, session.id));
    composer.clear();
    setMenu({ kind: "closed" });
  };

  const patchSession = (sessionId: string, patch: Parameters<typeof updateChatSession>[1]) =>
    patchAndReloadSession({ sessionId, patch, activeId, refreshList, loadDetail });

  const settleSession = (sessionId: string, title: string) =>
    removeSessionAndSelectNext({
      sessionId,
      title,
      successVerb: "Settled",
      failureMessage: "Could not settle thread",
      remove: () => updateChatSession(sessionId, { settledOverride: "settled" }),
      refreshList,
      activeIdRef,
      detailLoadGen,
      setDetail,
      setActiveId: input.setActiveId,
      setDetailLoading: input.setDetailLoading,
      loadDetail,
      showToast,
    });

  const deleteSession = (sessionId: string, title: string) =>
    removeSessionAndSelectNext({
      sessionId,
      title,
      successVerb: "Deleted",
      failureMessage: "Could not delete session",
      remove: () => deleteChatSession(sessionId),
      refreshList,
      activeIdRef,
      detailLoadGen,
      setDetail,
      setActiveId: input.setActiveId,
      setDetailLoading: input.setDetailLoading,
      loadDetail,
      showToast,
    });

  const handleOpenSession = useCallback(
    (sessionId: string) => void input.openSessionById(sessionId),
    [input.openSessionById],
  );

  const handleRetryFresh = useCallback(
    (runId: string) =>
      retrySessionRunFresh({
        runId,
        sessionId: active?.id,
        showToast,
        reloadDetailQuiet,
        refreshList,
      }),
    [active?.id, refreshList, reloadDetailQuiet, showToast],
  );

  const handleCreate = async (repoId: string) => {
    const session = await createChatSession({ repoId });
    await openCreatedSession(session);
  };

  const handleCreateTask = async () => {
    const session = await createChatSession({ scope: "general" });
    await openCreatedSession(session);
  };

  const handleSelect = (sessionId: string) =>
    selectSession({
      sessionId,
      activeId,
      markSessionRead,
      reloadDetailQuiet,
      setTyping: input.setTyping,
      setStreamProgress: input.setStreamProgress,
      setMenu,
      setDetail,
      loadDetail,
    });

  const unsettleSession = (sessionId: string, title: string) =>
    unsettleAndReloadSession({ sessionId, title, patchSession, showToast });

  const handleAbort = useCallback(
    () =>
      abortActiveConversation({
        sessionId: activeIdRef.current,
        aborting: input.aborting,
        assistantStateGenerationRef: input.assistantStateGenerationRef,
        setAborting: input.setAborting,
        clearSessionTyping: input.clearSessionTyping,
        clearSessionStreamProgress: (sessionId) => setSessionStreamProgress(sessionId, null),
        setDetail,
        showToast,
        reloadDetailQuiet,
        refreshList,
      }),
    [
      activeIdRef,
      input.aborting,
      input.assistantStateGenerationRef,
      input.setAborting,
      input.clearSessionTyping,
      refreshList,
      reloadDetailQuiet,
      setDetail,
      showToast,
    ],
  );

  const resetRuntimeSession = useCallback(
    (sessionId: string, activeRun: boolean) =>
      confirmAndResetRuntimeSession({
        sessionId,
        activeRun,
        isActiveSession: () => activeIdRef.current === sessionId,
        refreshList,
        reloadDetailQuiet,
        showToast,
      }),
    [activeIdRef, refreshList, reloadDetailQuiet, showToast],
  );

  return {
    handleOpenChatFile,
    handleOpenSession,
    handleRetryFresh,
    handleCreate,
    handleCreateTask,
    openCreatedSession,
    handleSelect,
    patchSession,
    settleSession,
    unsettleSession,
    deleteSession,
    handleAbort,
    resetRuntimeSession,
  };
};
