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
import type { SessionToastLink } from "./SessionModals";
import type { MenuItemBuilders, MenuState, SessionsRepo } from "./sessions-menu";
import { buildMenuItems } from "./sessions-menu";
import {
  countQueuedSessionMessages,
  menuHandlers,
  scopeMidRunHintsToMessages,
} from "./sessions-page-helpers";
import {
  attachRuntimeConfigurationNames,
  isAssistantConversationActive,
  pullRequestStateForMenu,
  runtimeConfigurationNameFor,
  runtimeConfigurationNameMap,
  sessionIdForRail,
  sessionPullRequestState,
  useDiffPanelRunCompletionRefresh,
  useLiveSessionGitStatus,
  useSessionPrComposerSlots,
  useSessionRailData,
} from "./sessions-page-internals";
import type { useSessionComposer } from "./use-session-composer";

export interface SessionsPageMenusInput {
  active: ChatSessionDetail | null;
  activeId: string | null;
  connected: boolean;
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
  setWorkspaceRefreshToken: Dispatch<SetStateAction<number>>;
  settlementNow: string;
  settleSession: (sessionId: string, title: string) => Promise<void>;
  showToast: (message: string, link?: SessionToastLink) => void;
  skills: string[] | undefined;
  typing: boolean;
  unsettleSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string, title: string) => Promise<void>;
  workspaceRefreshToken: number;
}

/** Derived workspace selectors + composer menus + rail publication (PLAN §6.1). */
export const useSessionsPageMenus = (input: SessionsPageMenusInput) => {
  const {
    active,
    activeId,
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
    showToast,
    skills,
    typing,
    workspaceRefreshToken,
  } = input;

  const runtimeConfigurationNames = useMemo(
    () => runtimeConfigurationNameMap(runtimeConfigurations),
    [runtimeConfigurations],
  );
  const sessionsWithRuntimeNames = useMemo(
    () => attachRuntimeConfigurationNames(sessions, runtimeConfigurationNames),
    [runtimeConfigurationNames, sessions],
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
  const { mergedPrBar, pullRequest } = useSessionPrComposerSlots(active?.id, sessionGitStatus);
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

  const menuBuilderArgs: MenuItemBuilders = {
    ...menuHandlers({
      menu,
      active,
      sessions,
      skills: skills ?? [],
      runtimeConfigurations,
      patchSession: input.patchSession,
      setSessions,
      showToast,
      setRename: input.setRename,
      setMenu,
      sendSkill: (name) => void composer.send(`/skill ${name}`),
      settleSession: input.settleSession,
      unsettleSession: input.unsettleSession,
      onResetRuntime: input.resetRuntimeSession,
      deleteSession: input.deleteSession,
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
      onSelect: (id) => void input.handleSelect(id),
      onNewSession: (repoId) => void input.handleCreate(repoId),
      onNewTask: () => void input.handleCreateTask(),
      onAttachRepo: () => input.onAttachRepo?.(),
      onAction: handleRailAction,
    });
    return () => setRailProps(null);
  });

  const menuItems = buildMenuItems(menuBuilderArgs);

  return {
    active,
    activePullRequestState,
    activeRuntimeConfigurationName,
    assistantActive,
    groups,
    handleRailAction,
    menuBuilderArgs,
    menuItems,
    mergedPrBar,
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
  };
};
