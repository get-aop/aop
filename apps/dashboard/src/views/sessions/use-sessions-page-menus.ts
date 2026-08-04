import type { RuntimeConfigurationProvider } from "@aop/common";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { ChatSessionDetail, ChatSessionSummary, updateChatSession } from "../../api/client";
import { setRailProps } from "../../shell/rail-store";
import type { Agent, Task } from "../../types";
import type { SessionToastLink } from "./SessionModals";
import type { MenuItemBuilders, MenuState, SessionsRepo } from "./sessions-menu";
import { buildMenuItems, parentMenuFor } from "./sessions-menu";
import { countQueuedSessionMessages, scopeMidRunHintsToMessages } from "./sessions-page-helpers";
import {
  attachRuntimeConfigurationNames,
  buildComposerMenuArgs,
  isAssistantConversationActive,
  moveMenuToParent,
  pullRequestStateForMenu,
  runtimeConfigurationNameFor,
  runtimeConfigurationNameMap,
  sessionIdForRail,
  sessionPullRequestState,
  useDiffPanelRunCompletionRefresh,
  useLiveSessionGitStatus,
  useSessionPrComposerSlots,
  useSessionRailData,
  withMenuBackItem,
} from "./sessions-page-internals";
import { resolveKnownTaskIds, resolveLiveTasks, workerColorMap } from "./sessions-page-model";
import type { useSessionComposer } from "./use-session-composer";

interface WorkflowOption {
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
}

export interface SessionsPageMenusInput {
  active: ChatSessionDetail | null;
  activeId: string | null;
  connected: boolean;
  agents: Agent[];
  composer: ReturnType<typeof useSessionComposer>;
  diffPanelOpen: boolean;
  handleCreate: (repoId: string) => Promise<void>;
  handleCreateTask: () => Promise<void>;
  handleSelect: (sessionId: string) => void;
  menu: MenuState;
  midRunHints: Record<string, "queued" | "steered">;
  onAttachRepo?: () => void;
  patchSession: (
    sessionId: string,
    patch: Parameters<typeof updateChatSession>[1],
  ) => Promise<ChatSessionSummary>;
  previousAssistantActive: MutableRefObject<boolean>;
  repos: SessionsRepo[];
  resetRuntimeSession: (sessionId: string, activeRun: boolean) => void;
  runtimeConfigurations: RuntimeConfigurationProvider[];
  sessions: ChatSessionSummary[];
  setDiffRefreshKey: Dispatch<SetStateAction<number>>;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  setRename: Dispatch<SetStateAction<{ id: string; value: string } | null>>;
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setTermOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceRefreshToken: Dispatch<SetStateAction<number>>;
  settlementNow: string;
  settleSession: (sessionId: string, title: string) => Promise<void>;
  showToast: (message: string, link?: SessionToastLink) => void;
  skills: string[] | undefined;
  tasks: Task[];
  termOpen: boolean;
  typing: boolean;
  unsettleSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string, title: string) => Promise<void>;
  workflowNames: string[];
  workflowOptions: WorkflowOption[];
  workspaceRefreshToken: number;
  knownTaskIds?: readonly string[];
}

/** Derived workspace selectors + composer menus + rail publication (PLAN §6.1). */
export const useSessionsPageMenus = (input: SessionsPageMenusInput) => {
  const {
    active,
    activeId,
    agents,
    composer,
    connected,
    diffPanelOpen,
    menu,
    midRunHints,
    repos,
    runtimeConfigurations,
    sessions,
    settlementNow,
    setDiffRefreshKey,
    setMenu,
    setSessions,
    setTermOpen,
    showToast,
    skills,
    tasks,
    termOpen,
    typing,
    workflowNames,
    workflowOptions,
    workspaceRefreshToken,
    knownTaskIds,
  } = input;

  const runtimeConfigurationNames = useMemo(
    () => runtimeConfigurationNameMap(runtimeConfigurations),
    [runtimeConfigurations],
  );
  const sessionsWithRuntimeNames = useMemo(
    () => attachRuntimeConfigurationNames(sessions, runtimeConfigurationNames),
    [runtimeConfigurationNames, sessions],
  );
  const workerNames = useMemo(() => agents.map((a) => a.name), [agents]);
  const workerColors = useMemo(() => workerColorMap(agents), [agents]);
  const workers = useMemo(
    () => agents.map((agent) => ({ id: agent.id, name: agent.name })),
    [agents],
  );
  const assistantActive = isAssistantConversationActive(active, typing);
  const scopedMidRunHints = useMemo(
    () => scopeMidRunHintsToMessages(active?.messages ?? [], midRunHints),
    [active?.messages, midRunHints],
  );
  const queueCount = useMemo(
    () => countQueuedSessionMessages(active?.messages ?? [], scopedMidRunHints),
    [active?.messages, scopedMidRunHints],
  );
  const sessionGitStatus = useLiveSessionGitStatus(
    active?.id,
    active?.workspacePath,
    assistantActive,
    workspaceRefreshToken,
  );
  const refreshWorkspace = useCallback(
    () => input.setWorkspaceRefreshToken((token) => token + 1),
    [input.setWorkspaceRefreshToken],
  );
  const { gitPrControls, mergedPrBar, pullRequest } = useSessionPrComposerSlots(
    active?.id,
    sessionGitStatus,
    showToast,
    refreshWorkspace,
  );
  const activePullRequestState = sessionPullRequestState(pullRequest, sessionGitStatus);
  const { sidebarPullRequestStates, groups, settled, generalTasks } = useSessionRailData({
    repos,
    sessions: sessionsWithRuntimeNames,
    activeSessionId: sessionIdForRail(active),
    activePullRequestState,
    settlementNow,
  });

  useDiffPanelRunCompletionRefresh(
    assistantActive,
    diffPanelOpen,
    input.previousAssistantActive,
    setDiffRefreshKey,
  );
  const activeRuntimeConfigurationName = runtimeConfigurationNameFor(
    active?.runtimeConfigurationId,
    runtimeConfigurationNames,
  );
  const derivedSkills = active?.skills;
  const liveTasks = useMemo(() => resolveLiveTasks(tasks, knownTaskIds), [tasks, knownTaskIds]);
  const knownTaskIdSet = useMemo(
    () => resolveKnownTaskIds(tasks, knownTaskIds),
    [tasks, knownTaskIds],
  );

  const menuBuilderArgs: MenuItemBuilders = {
    ...buildComposerMenuArgs({
      handlers: {
        menu,
        active,
        sessions,
        termOpen,
        skills: skills ?? [],
        runtimeConfigurations,
        patchSession: input.patchSession,
        setSessions,
        showToast,
        setRename: input.setRename,
        setMenu,
        setTermOpen,
        sendSkill: (name) => void composer.send(`/skill ${name}`),
        settleSession: input.settleSession,
        unsettleSession: input.unsettleSession,
        onResetRuntime: input.resetRuntimeSession,
        deleteSession: input.deleteSession,
      },
      composer,
      setMenu,
      agents,
      workflowNames,
      patchSession: input.patchSession,
      active,
    }),
    now: settlementNow,
    pullRequestState: pullRequestStateForMenu(menu, sidebarPullRequestStates),
  };

  const handleRailAction = (
    sessionId: string,
    action: "rename" | "pin" | "settle" | "unsettle" | "delete",
  ) => {
    const target = sessions.find((session) => session.id === sessionId);
    const title = target?.title ?? "Session";
    switch (action) {
      case "rename":
        menuBuilderArgs.onRename(sessionId, title);
        break;
      case "pin":
        menuBuilderArgs.onPin(sessionId, !(target?.pinned ?? false));
        break;
      case "settle":
        menuBuilderArgs.onSettle(sessionId, title);
        break;
      case "unsettle":
        menuBuilderArgs.onUnsettle(sessionId, title);
        break;
      case "delete":
        menuBuilderArgs.onDelete(sessionId, title);
        break;
    }
  };

  // Publish the thread list + actions to the shell's app rail (PLAN §6.1).
  useEffect(() => {
    setRailProps({
      groups,
      tasks: generalTasks,
      settled,
      activeSessionId: activeId,
      connected,
      workflowCount: workflowOptions.length,
      onSelect: (id) => void input.handleSelect(id),
      onNewSession: (repoId) => void input.handleCreate(repoId),
      onNewTask: () => void input.handleCreateTask(),
      onAttachRepo: () => input.onAttachRepo?.(),
      onAction: handleRailAction,
    });
    return () => setRailProps(null);
  });

  const baseMenuItems = buildMenuItems(menuBuilderArgs);
  const parentMenuKind = parentMenuFor(menu.kind);
  const menuItems = withMenuBackItem(baseMenuItems, parentMenuKind, () =>
    setMenu((current) => moveMenuToParent(current, parentMenuKind ?? "cadd")),
  );

  return {
    active,
    activePullRequestState,
    activeRuntimeConfigurationName,
    assistantActive,
    gitPrControls,
    groups,
    handleRailAction,
    knownTaskIdSet,
    liveTasks,
    menuBuilderArgs,
    menuItems,
    mergedPrBar,
    parentMenuKind,
    pullRequest,
    queueCount,
    refreshWorkspace,
    scopedMidRunHints,
    sessionGitStatus,
    sessionsWithRuntimeNames,
    settled,
    generalTasks,
    sidebarPullRequestStates,
    skills: derivedSkills,
    workerColors,
    workerNames,
    workers,
  };
};
