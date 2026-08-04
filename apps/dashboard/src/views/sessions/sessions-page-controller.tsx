import type { RuntimeProfile, TerminalLine } from "@aop/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatSessionDetail,
  type ChatSessionSummary,
  listChatSessions,
} from "../../api/client";
import { setDelegationSessionFocus } from "../../components/delegations/delegation-center";
import { useRuntimeConfiguration } from "../../hooks/runtime-configuration";
import { useActiveChatUnread } from "../../hooks/use-chat-unread";
import { useOpenSessionRequest } from "../../hooks/use-open-session-request";
import type { Agent, Task } from "../../types";
import { useActiveDelegationCount } from "../../workspace/tasks-pane";
import type { SessionToastContent, SessionToastLink } from "./SessionModals";
import { setSessionSidePanelCovered } from "./session-side-panel-cover";
import { setSessionStreamProgress } from "./session-stream-progress";
import type { MenuState, SessionsRepo } from "./sessions-menu";
import { type AssistantStreamProgress, storeActiveSessionId } from "./sessions-page-helpers";
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
import {
  effectiveCommandFor,
  resolveKnownTaskIds,
  useSessionVisibilitySync,
} from "./sessions-page-model";
import type { SessionsPageViewModel } from "./sessions-page-view";
import { useSessionBranches } from "./use-session-branches";
import { useSessionComposer } from "./use-session-composer";
import { clearSessionUnreadCount, useSessionUnreadCounts } from "./use-session-unread-counts";
import { useSessionsPageActions } from "./use-sessions-page-actions";
import { useSessionsPagePrefill, useSessionsPageStream } from "./use-sessions-page-effects";
import { useSessionsPageMenus } from "./use-sessions-page-menus";
import { useSessionsPagePanels } from "./use-sessions-page-panels";

interface SessionsPageProps {
  repos: SessionsRepo[];
  onNavigate: (path: string) => void;
  onOpenWorkerDialog?: () => void;
  /** Opens the register/attach repository directory browser. */
  onAttachRepo?: () => void;
  /** Live board tasks (SSE) for task-live cards and known-task checks. */
  tasks?: Task[];
  /** Prefill composer when opened from Pool "Open in chat" (`/?task=`). */
  focusTaskId?: string;
  /** Clear the one-shot `?task=` intent after prefill (mirrors Workers create consume). */
  onFocusTaskConsumed?: () => void;
  /** @deprecated Prefer `tasks` — kept for older callers. */
  knownTaskIds?: readonly string[];
}

export const useSessionsPageController = ({
  repos,
  onNavigate,
  onOpenWorkerDialog,
  onAttachRepo,
  tasks = [],
  focusTaskId,
  onFocusTaskConsumed,
  knownTaskIds,
}: SessionsPageProps) => {
  const { providers: runtimeConfigurations } = useRuntimeConfiguration();
  const settlementNow = useMinuteTimestamp();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfile[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowOptions, setWorkflowOptions] = useState<
    Array<{
      id: string;
      name: string;
      stepCount: number;
      stepTypes: string[];
      steps: Array<{
        id: string;
        type: string;
        provider?: string;
        model?: string;
        reasoning?: string;
        fastMode?: boolean;
      }>;
    }>
  >([]);
  const workflowNames = workflowOptions.map((workflow) => workflow.name);
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

  // Hide floating task/delegation cards while a side panel owns the top-right.
  useEffect(() => {
    setSessionSidePanelCovered(diffPanelOpen || mdPanel != null);
    return () => setSessionSidePanelCovered(false);
  }, [diffPanelOpen, mdPanel]);
  const [termLines, setTermLines] = useState<TerminalLine[]>([]);
  const [termInput, setTermInput] = useState("");
  const [workflowRun, setWorkflowRun] = useState<
    import("./composer-types").WorkflowRunViewState | null
  >(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const assistantStateGenerationRef = useRef(0);
  const skipConnectedReloadRef = useRef<string | null>(null);
  const detailLoadGen = useRef(0);
  activeIdRef.current = activeId;
  const { typing, setTyping, clearSessionTyping } = useSessionScopedTyping(activeId, activeIdRef);
  // Live stream text lives in session-stream-progress store so 25Hz chunks
  // only re-render the activity row, not the whole page/composer.
  const setStreamProgress = useCallback((value: AssistantStreamProgress | null) => {
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
    workflowRun,
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
      setTermLines([]);
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

  const { listActiveSessionBranches, switchActiveSessionBranch } = useSessionBranches({
    activeIdRef,
    setDetail,
    setWorkspaceRefreshToken,
    reloadDetailQuiet,
    refreshList,
    showToast,
  });

  useSessionsPagePrefill({
    refreshList,
    loadDetail,
    markSessionRead,
    setAgents,
    setDetail,
    setWorkspaceError,
    setDetailLoading,
    setRuntimeProfiles,
    setWorkflowOptions,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot prefill; do not re-run on tasks[] SSE identity
  useEffect(() => {
    if (!focusTaskId) return;
    const task = tasks.find((item) => item.id === focusTaskId);
    const label = task?.sourceTitle?.trim() || task?.changePath?.split("/").pop() || focusTaskId;
    composer.setInput(`About task ${label} (${focusTaskId}): `);
    onFocusTaskConsumed?.();
  }, [focusTaskId, onFocusTaskConsumed]);

  useSessionVisibilitySync(activeIdRef, reloadDetailQuiet, refreshList);

  // Delegation cards only show for the session currently open in this page.
  useEffect(() => {
    setDelegationSessionFocus(activeId);
    return () => setDelegationSessionFocus(null);
  }, [activeId]);

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
    setTermLines,
    refreshList,
    reloadDetailQuiet,
    onOpenWorkerDialog,
    openSessionById,
    markSessionRead,
    setWorkflowRun,
  });
  const knownTaskIdSet = useMemo(
    () => resolveKnownTaskIds(tasks, knownTaskIds),
    [tasks, knownTaskIds],
  );
  const tasksBadge = useActiveDelegationCount();
  const {
    openRightPanel,
    closeRightPanel,
    toggleRightPanel,
    setRightPanelTab,
    rightPanel,
    termOpen,
    setTermOpen,
  } = useSessionsPagePanels();
  const {
    handleOpenChatFile,
    handleChatAction,
    handleRetryFresh,
    handleCreate,
    handleCreateTask,
    handleSelect,
    patchSession,
    settleSession,
    unsettleSession,
    deleteSession,
    handleTermRun,
    handleAbort,
    resetRuntimeSession,
    handleCreateWorktree,
  } = useSessionsPageActions({
    active: detail,
    activeId,
    activeIdRef,
    detailLoadGen,
    aborting,
    assistantStateGenerationRef,
    setAborting,
    composer,
    knownTaskIdSet,
    termInput,
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
    setTermLines,
    setTermInput,
    setDiffPanelOpen,
    setMdPanel,
    setWorkspaceRefreshToken,
    showToast,
    onNavigate,
    onOpenWorkerDialog,
    openSessionById,
  });
  const {
    active,
    activeRuntimeConfigurationName,
    assistantActive,
    gitPrControls,
    liveTasks,
    menuItems,
    mergedPrBar,
    parentMenuKind,
    pullRequest,
    queueCount,
    refreshWorkspace,
    scopedMidRunHints,
    sessionGitStatus,
    skills,
    workerColors,
    workerNames,
    workers,
  } = useSessionsPageMenus({
    active: detail,
    activeId,
    connected,
    agents,
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
    setTermOpen,
    setWorkspaceRefreshToken,
    settlementNow,
    settleSession,
    showToast,
    skills: detail?.skills,
    tasks,
    termOpen,
    typing,
    unsettleSession,
    deleteSession,
    workflowNames,
    workflowOptions,
    workspaceRefreshToken,
    knownTaskIds,
  });
  const ecmd = effectiveCommandFor(active);

  const sidePanelOpen = mdPanel !== null || diffPanelOpen;
  const draftSession = isDraftSession(active, assistantActive);

  const viewModel: SessionsPageViewModel = {
    aborting,
    active,
    activeId,
    activeRuntimeConfigurationName,
    agents,
    assistantActive,
    composer,
    connected,
    detailLoading,
    diffPanelOpen,
    diffRefreshKey,
    draftSession,
    ecmd,
    gitPrControls,
    handleAbort,
    handleChatAction,
    handleCreateWorktree,
    handleOpenChatFile,
    handleRetryFresh,
    handleTermRun,
    listActiveSessionBranches,
    liveTasks,
    mdPanel,
    mdPanelExpanded,
    mdPanelWidth,
    menu,
    menuItems,
    mergedPrBar,
    onNavigate,
    parentMenuKind,
    patchSession,
    previousMdPanelWidth,
    pullRequest,
    refreshWorkspace,
    queueCount,
    rename,
    repos,
    rightPanelOpen: rightPanel.open,
    tasksBadge,
    rightPanelTab: rightPanel.tab,
    openRightPanel,
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
    setTermInput,
    setTermOpen,
    setWorkspaceRefreshToken,
    showToast,
    sidePanelOpen,
    skills,
    switchActiveSessionBranch,
    termInput,
    termLines,
    termOpen,
    toast,
    typing,
    workerColors,
    workerNames,
    workers,
    workflowOptions,
    workflowRun,
    workspaceError,
  };

  return viewModel;
};
