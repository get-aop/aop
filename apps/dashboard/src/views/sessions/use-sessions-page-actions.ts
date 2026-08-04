import type { TerminalLine } from "@aop/common";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import {
  type ChatSessionAction,
  type ChatSessionDetail,
  type ChatSessionSummary,
  createChatSession,
  deleteChatSession,
  updateChatSession,
} from "../../api/client";
import type { SessionToastLink } from "./SessionModals";
import { setSessionStreamProgress } from "./session-stream-progress";
import type { MenuState } from "./sessions-menu";
import type { AssistantStreamProgress } from "./sessions-page-helpers";
import { confirmAndResetRuntimeSession, navigateFromAction } from "./sessions-page-helpers";
import {
  abortActiveConversation,
  createSessionWorktreeForComposer,
  openResolvedMarkdownFromChat,
  patchAndReloadSession,
  removeSessionAndSelectNext,
  retrySessionRunFresh,
  runSessionTerminalCommand,
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
  knownTaskIdSet: readonly string[] | undefined;
  termInput: string;
  markSessionRead: (sessionId: string) => void;
  loadDetail: (sessionId: string) => Promise<ChatSessionDetail | null>;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  clearSessionTyping: (sessionId: string) => void;
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: AssistantStreamProgress | null) => void;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  setTermLines: Dispatch<SetStateAction<TerminalLine[]>>;
  setTermInput: Dispatch<SetStateAction<string>>;
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>;
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>;
  setWorkspaceRefreshToken: Dispatch<SetStateAction<number>>;
  showToast: (message: string, link?: SessionToastLink) => void;
  onNavigate: (path: string) => void;
  onOpenWorkerDialog?: () => void;
  openSessionById: (sessionId: string) => Promise<void>;
}

/** Thread/workspace action handlers (select, settle, delete, abort, terminal…). */
export const useSessionsPageActions = (input: SessionsPageActionsInput) => {
  const {
    active,
    activeId,
    activeIdRef,
    detailLoadGen,
    composer,
    knownTaskIdSet,
    markSessionRead,
    loadDetail,
    reloadDetailQuiet,
    refreshList,
    setDetail,
    setSessions,
    setMenu,
    setTermLines,
    showToast,
    onNavigate,
    onOpenWorkerDialog,
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
    setTermLines([]);
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

  const handleChatAction = useCallback(
    (action: ChatSessionAction) =>
      navigateFromAction(
        action,
        onNavigate,
        onOpenWorkerDialog,
        showToast,
        knownTaskIdSet,
        (sessionId) => void input.openSessionById(sessionId),
      ),
    [input.openSessionById, knownTaskIdSet, onNavigate, onOpenWorkerDialog, showToast],
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
      setTermLines,
      setTyping: input.setTyping,
      setStreamProgress: input.setStreamProgress,
      setMenu,
      setDetail,
      loadDetail,
    });

  const unsettleSession = (sessionId: string, title: string) =>
    unsettleAndReloadSession({ sessionId, title, patchSession, showToast });

  const handleTermRun = () =>
    runSessionTerminalCommand({
      termInput: input.termInput,
      sessionId: active?.id,
      setTermLines,
      setTermInput: input.setTermInput,
      showToast,
    });

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

  const handleCreateWorktree = useCallback(
    (sessionId: string, branchName: string) =>
      createSessionWorktreeForComposer({
        sessionId,
        branchName,
        showToast,
        reloadDetailQuiet,
        refreshList,
        onWorkspaceChanged: () => input.setWorkspaceRefreshToken((token) => token + 1),
      }),
    [input.setWorkspaceRefreshToken, refreshList, reloadDetailQuiet, showToast],
  );

  return {
    handleOpenChatFile,
    handleChatAction,
    handleRetryFresh,
    handleCreate,
    handleCreateTask,
    openCreatedSession,
    handleSelect,
    patchSession,
    settleSession,
    unsettleSession,
    deleteSession,
    handleTermRun,
    handleAbort,
    resetRuntimeSession,
    handleCreateWorktree,
  };
};
