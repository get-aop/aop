import type {
  RuntimeConfigurationProvider,
  RuntimeProfile,
  SessionGitBranchList,
  TerminalLine,
} from "@aop/common";
import { type MenuListItem, MenuPanel } from "@/ui/menu-panel";
import { ResizablePanel, ResizablePanelGroup } from "@/ui/resizable";
import type {
  ChatSessionAction,
  ChatSessionDetail,
  SessionGitStatus,
  updateChatSession,
} from "../../api/client";
import type { Agent } from "../../types";
import { RightPanel } from "../../workspace/right-panel";
import { TerminalDock } from "../../workspace/terminal-dock";
import { ChatThread } from "./ChatThread";
import { ComposerFileInputs } from "./ComposerFileInputs";
import { type DraftSuggestionId, DraftSuggestions, DraftWordmark } from "./draft-hero";
import type { SessionToastContent, SessionToastLink } from "./SessionModals";
import { RenameSessionModal, SessionToast } from "./SessionModals";
import { SessionWorkspaceTopBar } from "./SessionWorkspaceTopBar";
import type { MenuState, ParentMenuKind, SessionsRepo } from "./sessions-menu";
import { menuMinWidth, menuTitle } from "./sessions-menu";
import { SessionsComposer } from "./sessions-page-composer";
import {
  closeOrBackMenu,
  composerMenuAppearance,
  SessionChangedFilesSlot,
  SessionDetailLoading,
  SessionRuntimeProfiles,
  SessionSidePanelSlot,
  visibleWorkspaceError,
  WorkspaceBindingErrorPanel,
  type WorkspaceBindingViewError,
} from "./sessions-page-internals";
import { anchorForMenu, emptySessionMessage } from "./sessions-page-model";
import { RightPanelTabContent } from "./sessions-page-right-panel-content";
import type { useSessionComposer } from "./use-session-composer";
import type { SessionPullRequestController } from "./use-session-pull-request";

type ComposerState = ReturnType<typeof useSessionComposer>;

type WorkflowOption = {
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
};

export interface SessionsPageViewModel {
  aborting: boolean;
  active: ChatSessionDetail | null;
  activeId: string | null;
  activeRuntimeConfigurationName: string | null;
  agents: Agent[];
  assistantActive: boolean;
  composer: ComposerState;
  connected: boolean;
  detailLoading: boolean;
  diffPanelOpen: boolean;
  diffRefreshKey: number;
  draftSession: boolean;
  ecmd: string;
  gitPrControls: React.ReactNode;
  handleAbort: () => void;
  handleChatAction: (action: ChatSessionAction) => void;
  handleCreateWorktree: (sessionId: string, branchName: string) => Promise<void>;
  handleOpenChatFile: (path: string) => void;
  handleRetryFresh: (runId: string) => void;
  handleTermRun: () => void;
  listActiveSessionBranches: () => Promise<SessionGitBranchList>;
  liveTasks: Array<{ id: string; status: string }>;
  mdPanel: { path: string } | null;
  mdPanelExpanded: boolean;
  mdPanelWidth: number;
  menu: MenuState;
  menuItems: MenuListItem[];
  mergedPrBar: React.ReactNode;
  onNavigate: (path: string) => void;
  parentMenuKind: ParentMenuKind | null;
  patchSession: (
    sessionId: string,
    patch: Parameters<typeof updateChatSession>[1],
  ) => Promise<unknown>;
  previousMdPanelWidth: React.MutableRefObject<number>;
  pullRequest: SessionPullRequestController | null;
  queueCount: number;
  refreshWorkspace: () => void;
  rename: { id: string; value: string } | null;
  repos: SessionsRepo[];
  rightPanelOpen: boolean;
  rightPanelTab: import("../../workspace/right-panel").RightPanelTab;
  openRightPanel: (tab: import("../../workspace/right-panel").RightPanelTab) => void;
  closeRightPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: import("../../workspace/right-panel").RightPanelTab) => void;
  tasksBadge: number;
  resetUnavailableWorkspace: () => Promise<void>;
  runtimeConfigurations: RuntimeConfigurationProvider[];
  runtimeProfiles: RuntimeProfile[];
  scopedMidRunHints: Record<string, "queued" | "steered">;
  sessionContentRef: React.RefObject<HTMLDivElement | null>;
  sessionGitStatus: SessionGitStatus | null;
  setDetail: React.Dispatch<React.SetStateAction<ChatSessionDetail | null>>;
  setDiffPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDiffRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  setMdPanel: React.Dispatch<React.SetStateAction<{ path: string } | null>>;
  setMdPanelExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setMdPanelWidth: React.Dispatch<React.SetStateAction<number>>;
  setMenu: React.Dispatch<React.SetStateAction<MenuState>>;
  setRename: React.Dispatch<React.SetStateAction<{ id: string; value: string } | null>>;
  setTermInput: (value: string) => void;
  setTermOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceRefreshToken: React.Dispatch<React.SetStateAction<number>>;
  showToast: (message: string, link?: SessionToastLink) => void;
  sidePanelOpen: boolean;
  skills: string[] | undefined;
  switchActiveSessionBranch: (branch: string) => Promise<void>;
  termInput: string;
  termLines: TerminalLine[];
  termOpen: boolean;
  toast: SessionToastContent | null;
  typing: boolean;
  workerColors: Record<string, string>;
  workerNames: string[];
  workers: Array<{ id: string; name: string }>;
  workflowOptions: WorkflowOption[];
  /** Active chat workflow run: locks the composer and shows step progress. */
  workflowRun: import("./composer-types").WorkflowRunViewState | null;
  workspaceError: WorkspaceBindingViewError | null;
}

/** Pure render for the sessions workspace — all state lives in SessionsPage. */
export const SessionsPageView = ({ view }: { view: SessionsPageViewModel }) => {
  const {
    active,
    activeId,
    composer,
    detailLoading,
    diffPanelOpen,
    diffRefreshKey,
    ecmd,
    mdPanel,
    mdPanelExpanded,
    mdPanelWidth,
    menu,
    menuItems,
    parentMenuKind,
    patchSession,
    previousMdPanelWidth,
    pullRequest,
    refreshWorkspace,
    rename,
    repos,
    rightPanelOpen,
    toggleRightPanel,
    resetUnavailableWorkspace,
    sessionContentRef,
    sessionGitStatus,
    setDiffPanelOpen,
    setMdPanel,
    setMdPanelExpanded,
    setMdPanelWidth,
    setMenu,
    setRename,
    setTermOpen,
    showToast,
    termOpen,
    toast,
    workspaceError,
  } = view;

  return (
    <div
      data-testid="sessions-page"
      className="sessions-t3-shell h-full min-h-0"
      style={{ flex: 1, minHeight: 0, display: "flex" }}
    >
      <ComposerFileInputs
        imageRef={composer.imageInputRef}
        documentRef={composer.documentInputRef}
        onImages={(files) => void composer.attachImages(files)}
        onDocuments={(files) => void composer.attachDocuments(files)}
      />
      <div ref={sessionContentRef} style={{ flex: 1, minWidth: 0, display: "flex" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SessionDetailLoading loading={detailLoading} active={active} />
          <WorkspaceBindingErrorPanel
            error={visibleWorkspaceError(detailLoading, active, workspaceError)}
            sessionId={activeId}
            onReset={() => void resetUnavailableWorkspace()}
          />
          {active ? (
            <>
              <SessionWorkspaceTopBar
                session={active}
                gitStatus={sessionGitStatus}
                pr={pullRequest}
                onToast={showToast}
                onGitChanged={refreshWorkspace}
                onRenameTitle={(title) => void patchSession(active.id, { title })}
                termOpen={termOpen}
                onToggleTerm={() => setTermOpen((open) => !open)}
                rightPanelOpen={rightPanelOpen}
                onToggleRightPanel={toggleRightPanel}
              />
              <WorkspacePanels view={view} />
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "grid",
                placeItems: "center",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {emptySessionMessage(repos.length)}
            </div>
          )}
        </div>
        <SessionSidePanelSlot
          diffPanelOpen={diffPanelOpen}
          activeSessionId={active?.id}
          mdPanel={mdPanel}
          mdPanelWidth={mdPanelWidth}
          mdPanelExpanded={mdPanelExpanded}
          containerWidth={sessionContentRef.current?.clientWidth}
          previousMdPanelWidth={previousMdPanelWidth}
          setMdPanelWidth={setMdPanelWidth}
          setMdPanelExpanded={setMdPanelExpanded}
          setMdPanel={setMdPanel}
          setDiffPanelOpen={setDiffPanelOpen}
          showToast={showToast}
          diffRefreshKey={diffRefreshKey}
        />
      </div>

      <MenuPanel
        open={menu.kind !== "closed"}
        anchor={anchorForMenu(menu)}
        title={menuTitle(menu.kind, ecmd)}
        minWidth={menuMinWidth(menu.kind)}
        items={menuItems}
        appearance={composerMenuAppearance(menu.kind)}
        onClose={() => closeOrBackMenu(setMenu, parentMenuKind)}
        onDismiss={() => setMenu({ kind: "closed" })}
      />

      <RenameSessionModal
        open={!!rename}
        value={rename?.value ?? ""}
        onChange={(value) => setRename((current) => (current ? { ...current, value } : null))}
        onCancel={() => setRename(null)}
        onSave={() => {
          if (!rename) return;
          const title = rename.value.trim() || "Untitled session";
          void patchSession(rename.id, { title }).then(() => setRename(null));
        }}
      />

      <SessionToast toast={toast} />
    </div>
  );
};

/**
 * Minimal v4 layout persistence (v4 has no autoSaveId): remember the layout
 * map only while every panel is mounted, restore it as defaultLayout.
 */
const persistedGroupProps = (storageKey: string) => {
  const read = (): Record<string, number> | undefined => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return undefined;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
    } catch {
      // ignore corrupt storage
    }
    return undefined;
  };
  return {
    defaultLayout: read(),
    onLayoutChanged: (layout: Record<string, number>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(layout));
      } catch {
        // storage may be unavailable (Tauri/webview sandbox)
      }
    },
  };
};

const WorkspacePanels = ({ view }: { view: SessionsPageViewModel }) => {
  const {
    active,
    closeRightPanel,
    composer,
    diffRefreshKey,
    draftSession,
    ecmd,
    handleTermRun,
    handleChatAction,
    handleOpenChatFile,
    handleRetryFresh,
    liveTasks,
    onNavigate,
    patchSession,
    pullRequest,
    rightPanelOpen,
    rightPanelTab,
    runtimeProfiles,
    scopedMidRunHints,
    sessionGitStatus,
    setRightPanelTab,
    setTermInput,
    setTermOpen,
    showToast,
    tasksBadge,
    termInput,
    termLines,
    termOpen,
    typing,
    workerColors,
    workerNames,
    workers,
    workflowOptions,
  } = view;

  if (!active) return null;

  /** Draft hero suggestions: prefill the composer; “Ship it” also arms the seed workflow. */
  const applyDraftSuggestion = (id: DraftSuggestionId) => {
    const prompts: Record<DraftSuggestionId, string> = {
      feature: "Implement a feature",
      review: "Review a pull request",
      debug: "Debug failing tests",
      "ship-it": "Run “Ship it”",
    };
    composer.setInput(prompts[id]);
    if (id === "ship-it") {
      const shipIt = workflowOptions.find((option) => option.name === "Ship it");
      if (shipIt) {
        composer.setWorkflowSelection({
          workflowId: shipIt.id,
          name: shipIt.name,
          stepCount: shipIt.stepCount,
          steps: shipIt.steps,
        });
      }
    }
  };

  return (
    <ResizablePanelGroup
      orientation="vertical"
      {...persistedGroupProps("aop:panel-layout:dock")}
      className="min-h-0 w-full flex-1"
    >
      <ResizablePanel
        id="dock-main"
        defaultSize={termOpen ? "75" : "100"}
        minSize={30}
        className="min-h-0"
      >
        <ResizablePanelGroup
          orientation="horizontal"
          {...persistedGroupProps("aop:panel-layout:right")}
          className="h-full min-w-0"
        >
          <ResizablePanel id="right-main" defaultSize="70" minSize={400} className="min-w-0">
            <div
              className={`session-conversation-body h-full${draftSession ? " session-conversation-body--draft" : ""}`}
            >
              {draftSession ? <DraftWordmark /> : null}
              <ChatThread
                key={active.id}
                sessionId={active.id}
                repoPath={active.workspacePath}
                onOpenFile={handleOpenChatFile}
                repoName={active.repoName}
                runtime={active.runtime}
                model={active.model}
                effort={active.reasoningEffort}
                alias={active.runtimeAlias}
                messages={active.messages}
                midRunHints={scopedMidRunHints}
                typing={typing}
                workerNames={workerNames}
                workers={workers}
                workerColors={workerColors}
                onAction={handleChatAction}
                onNavigate={onNavigate}
                tasks={liveTasks}
                onRetryFresh={handleRetryFresh}
                assistantFooter={
                  <SessionChangedFilesSlot
                    session={active}
                    gitStatus={sessionGitStatus}
                    refreshKey={diffRefreshKey}
                    onOpenFile={handleOpenChatFile}
                  />
                }
              />
              <SessionRuntimeProfiles
                profiles={runtimeProfiles}
                onApply={(profile) => {
                  void patchSession(active.id, { runtimeProfileId: profile.id }).then(() =>
                    showToast(`Applied ${profile.name}`),
                  );
                }}
              />
              <SessionsComposer view={view} />
              {draftSession ? <DraftSuggestions onSuggestion={applyDraftSuggestion} /> : null}
            </div>
          </ResizablePanel>
          {rightPanelOpen ? (
            <ResizablePanel
              id="right-pane"
              defaultSize="30"
              minSize={280}
              maxSize={640}
              className="min-w-0"
            >
              <RightPanel
                tab={rightPanelTab}
                onTabChange={setRightPanelTab}
                onClose={closeRightPanel}
                tasksBadge={tasksBadge}
              >
                {(tab) => (
                  <RightPanelTabContent
                    tab={tab}
                    active={active}
                    onCloseDiff={closeRightPanel}
                    showToast={showToast}
                    diffRefreshKey={diffRefreshKey}
                    pullRequest={pullRequest}
                    termLines={termLines}
                  />
                )}
              </RightPanel>
            </ResizablePanel>
          ) : null}
        </ResizablePanelGroup>
      </ResizablePanel>
      {termOpen ? (
        <ResizablePanel id="dock" defaultSize="25" minSize={96} maxSize={480} className="min-h-0">
          <TerminalDock
            ecmd={ecmd}
            repoPath={active.workspacePath ?? active.repoPath ?? ""}
            branch={sessionGitStatus?.branch ?? null}
            termLines={termLines}
            termInput={termInput}
            onTermInput={setTermInput}
            onTermRun={handleTermRun}
            onTermClose={() => setTermOpen(false)}
          />
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  );
};
