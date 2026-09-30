import type { RuntimeProfile } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatSessionDetail,
  type ChatSessionSummary,
  listChatSessions,
} from "../../api/client";
import { useRuntimeConfiguration } from "../../hooks/runtime-configuration";
import { useActiveChatUnread } from "../../hooks/use-chat-unread";
import { useOpenSessionRequest } from "../../hooks/use-open-session-request";
import type { SessionToastContent, SessionToastLink } from "./SessionModals";
import { type StreamProgressUpdate, setSessionStreamProgress } from "./session-stream-progress";
import type { MenuState, SessionsRepo } from "./sessions-menu";
import { storeActiveSessionId } from "./sessions-page-helpers";
import {
  fetchAndStoreSessionDetail,
  isDraftSession,
  readStoredPanelWidth,
  reloadSessionDetailQuiet,
  resetUnavailableWorkspaceBinding,
  toastContent,
  useMinuteTimestamp,
  useSessionScopedTyping,
  type WorkspaceBindingViewError,
} from "./sessions-page-internals";
import { effectiveCommandFor, useSessionVisibilitySync } from "./sessions-page-model";
import type { SessionsPageViewModel } from "./sessions-page-view";
import { useSessionComposer } from "./use-session-composer";
import { clearSessionUnreadCount, useSessionUnreadCounts } from "./use-session-unread-counts";
import { useSessionsPageActions } from "./use-sessions-page-actions";
import { useSessionsPagePrefill, useSessionsPageStream } from "./use-sessions-page-effects";
import { useSessionsPageMenus } from "./use-sessions-page-menus";
import { useSessionsPagePanels } from "./use-sessions-page-panels";

interface SessionsPageProps {
  repos: SessionsRepo[];
  /** Opens the register/attach repository directory browser. */
  onAttachRepo?: () => void;
}

export const useSessionsPageController = ({ repos, onAttachRepo }: SessionsPageProps) => {
  const { providers: runtimeConfigurations } = useRuntimeConfiguration();
  const settlementNow = useMinuteTimestamp();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceBindingViewError | null>(null);
  const [midRunHints, setMidRunHints] = useState<Record<string, "queued" | "steered">>({});
  const [aborting, setAborting] = useState(false);
  const [menu, setMenu] = useState<MenuState>({ kind: "closed" });
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [toast, setToast] = useState<SessionToastContent | null>(null);
  const [mdPanel, setMdPanel] = useState<{ path: string } | null>(null);
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [diffRefreshKey, setDiffRefreshKey] = useState(0);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [mdPanelWidth, setMdPanelWidth] = useState(readStoredPanelWidth);
  const [mdPanelExpanded, setMdPanelExpanded] = useState(false);
  const previousMdPanelWidth = useRef(540);
  const previousAssistantActive = useRef(false);
  const sessionContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mdPanelExpanded) return;
    localStorage.setItem("aop:md-panel-width", String(Math.round(mdPanelWidth)));
  }, [mdPanelExpanded, mdPanelWidth]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const assistantStateGenerationRef = useRef(0);
  const skipConnectedReloadRef = useRef<string | null>(null);
  const detailLoadGen = useRef(0);
  activeIdRef.current = activeId;
  const { typing, setTyping, clearSessionTyping } = useSessionScopedTyping(activeId, activeIdRef);
  // Live stream text lives in session-stream-progress store so 25Hz chunks
  // only re-render the activity row, not the whole page/composer.
  const setStreamProgress = useCallback((value: StreamProgressUpdate) => {
    setSessionStreamProgress(activeIdRef.current, value);
  }, []);

  const showToast = useCallback((message: string, link?: SessionToastLink) => {
    setToast(toastContent(message, link));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const refreshList = useCallback(async () => {
    const list = await listChatSessions();
    setSessions(list);
    return list;
  }, []);

  const composer = useSessionComposer({
    active: detail,
    typing,
    setTyping,
    setStreamProgress,
    setDetail,
    setMidRunHints,
    showToast,
    refreshList,
  });

  const loadDetail = useCallback(
    (sessionId: string) => {
      const gen = ++detailLoadGen.current;
      skipConnectedReloadRef.current = sessionId;
      // Clear previous session local activity before switching identity.
      const previousId = activeIdRef.current;
      if (previousId && previousId !== sessionId) {
        clearSessionTyping(previousId);
        setSessionStreamProgress(previousId, null);
      }
      setActiveId(sessionId);
      setMdPanel(null);
      activeIdRef.current = sessionId;
      storeActiveSessionId(sessionId);
      setDetailLoading(true);
      setWorkspaceError(null);
      return fetchAndStoreSessionDetail({
        sessionId,
        generation: gen,
        currentGeneration: detailLoadGen,
        setDetail,
        setDetailLoading,
        setWorkspaceError,
      });
    },
    [clearSessionTyping],
  );

  const resetUnavailableWorkspace = useCallback(
    () =>
      resetUnavailableWorkspaceBinding({
        sessionId: activeId,
        setWorkspaceError,
        loadDetail,
        refreshList,
        showToast,
      }),
    [activeId, loadDetail, refreshList, showToast],
  );

  const reloadDetailQuiet = useCallback(
    (sessionId: string) =>
      reloadSessionDetailQuiet({ sessionId, activeIdRef, setDetail, clearSessionTyping }),
    [clearSessionTyping],
  );
  const markSessionRead = useSessionUnreadCounts(activeIdRef, setSessions);

  /** Open a session by id (e.g. /clear sibling). Always leaves the previous thread. */
  const openSessionById = useCallback(
    async (sessionId: string) => {
      setTyping(false);
      setStreamProgress(null);
      setMenu({ kind: "closed" });
      // Leave per-session composer drafts intact; only drop the in-view detail.
      setDetail(null);
      void markSessionRead(sessionId);
      await refreshList();
      // refreshList may race the mark-read POST; re-apply the optimistic clear.
      setSessions((current) => clearSessionUnreadCount(current, sessionId));
      await loadDetail(sessionId);
    },
    [loadDetail, markSessionRead, refreshList, setStreamProgress, setTyping],
  );

  useSessionsPagePrefill({
    refreshList,
    loadDetail,
    markSessionRead,
    setDetail,
    setWorkspaceError,
    setDetailLoading,
    setRuntimeProfiles,
  });

  useSessionVisibilitySync(activeIdRef, reloadDetailQuiet, refreshList);

  useActiveChatUnread(activeId);
  useOpenSessionRequest((sessionId) => {
    void openSessionById(sessionId);
  });

  const { connected } = useSessionsPageStream({
    activeId,
    activeIdRef,
    assistantStateGenerationRef,
    skipConnectedReloadRef,
    setTyping,
    setStreamProgress,
    setDetail,
    setMidRunHints,
    refreshList,
    reloadDetailQuiet,
    openSessionById,
    markSessionRead,
  });
  const { rightPanel, closeRightPanel, toggleRightPanel, setRightPanelTab } =
    useSessionsPagePanels();
  const {
    handleOpenChatFile,
    handleOpenSession,
    handleRetryFresh,
    handleCreate,
    handleCreateTask,
    handleSelect,
    patchSession,
    settleSession,
    unsettleSession,
    deleteSession,
    handleAbort,
    resetRuntimeSession,
  } = useSessionsPageActions({
    active: detail,
    activeId,
    activeIdRef,
    detailLoadGen,
    aborting,
    assistantStateGenerationRef,
    setAborting,
    composer,
    markSessionRead,
    loadDetail,
    reloadDetailQuiet,
    refreshList,
    clearSessionTyping,
    setTyping,
    setStreamProgress,
    setDetail,
    setActiveId,
    setDetailLoading,
    setSessions,
    setMenu,
    setDiffPanelOpen,
    setMdPanel,
    showToast,
    openSessionById,
  });
  const {
    active,
    activeRuntimeConfigurationName,
    assistantActive,
    menuItems,
    mergedPrBar,
    pullRequest,
    queueCount,
    refreshWorkspace,
    scopedMidRunHints,
    sessionGitStatus,
    skills,
  } = useSessionsPageMenus({
    active: detail,
    activeId,
    connected,
    composer,
    diffPanelOpen,
    handleCreate,
    handleCreateTask,
    handleSelect,
    menu,
    midRunHints,
    onAttachRepo,
    patchSession,
    previousAssistantActive,
    repos,
    resetRuntimeSession,
    runtimeConfigurations,
    sessions,
    setDiffRefreshKey,
    setMenu,
    setRename,
    setSessions,
    setWorkspaceRefreshToken,
    settlementNow,
    settleSession,
    showToast,
    skills: detail?.skills,
    typing,
    unsettleSession,
    deleteSession,
    workspaceRefreshToken,
  });
  const ecmd = effectiveCommandFor(active);

  const sidePanelOpen = mdPanel !== null || diffPanelOpen;
  const draftSession = isDraftSession(active, assistantActive);

  const viewModel: SessionsPageViewModel = {
    aborting,
    active,
    activeId,
    activeRuntimeConfigurationName,
    assistantActive,
    composer,
    connected,
    detailLoading,
    diffPanelOpen,
    diffRefreshKey,
    draftSession,
    ecmd,
    handleAbort,
    handleOpenChatFile,
    handleOpenSession,
    handleRetryFresh,
    mdPanel,
    mdPanelExpanded,
    mdPanelWidth,
    menu,
    menuItems,
    mergedPrBar,
    patchSession,
    previousMdPanelWidth,
    pullRequest,
    refreshWorkspace,
    queueCount,
    rename,
    repos,
    rightPanelOpen: rightPanel.open,
    rightPanelTab: rightPanel.tab,
    closeRightPanel,
    toggleRightPanel,
    setRightPanelTab,
    resetUnavailableWorkspace,
    runtimeConfigurations,
    runtimeProfiles,
    scopedMidRunHints,
    sessionContentRef,
    sessionGitStatus,
    setDetail,
    setDiffPanelOpen,
    setDiffRefreshKey,
    setMdPanel,
    setMdPanelExpanded,
    setMdPanelWidth,
    setMenu,
    setRename,
    showToast,
    sidePanelOpen,
    skills,
    toast,
    typing,
    workspaceError,
  };

  return viewModel;
};
