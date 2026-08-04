import { suggestSessionBranchName } from "@aop/common";

import { readAnchorRect } from "@/ui/menu-panel";
import { ChatComposer } from "./ChatComposer";
import { createSessionCommitHandler } from "./session-commit";
import {
  diffstatForComposer,
  patchComposerSetting,
  runtimeAccessModeFor,
  sessionSupportsFastMode,
  worktreeCreateHandler,
} from "./sessions-page-internals";
import type { SessionsPageViewModel } from "./sessions-page-view";

/** The composer with its full chrome — extracted to keep the view flat. */
export const SessionsComposer = ({ view }: { view: SessionsPageViewModel }) => {
  const {
    aborting,
    active,
    activeRuntimeConfigurationName,
    agents,
    assistantActive,
    composer,
    connected,
    gitPrControls,
    handleAbort,
    handleCreateWorktree,
    handleTermRun,
    listActiveSessionBranches,
    openRightPanel,
    tasksBadge,
    mergedPrBar,
    patchSession,
    queueCount,
    repos,
    runtimeConfigurations,
    sessionGitStatus,
    setDetail,
    setMenu,
    setTermInput,
    setTermOpen,
    setWorkspaceRefreshToken,
    showToast,
    skills,
    switchActiveSessionBranch,
    termInput,
    termLines,
    termOpen,
    workflowOptions,
  } = view;

  if (!active) return null;

  return (
    <ChatComposer
      sessionId={active.id}
      input={composer.input}
      onInput={composer.setInput}
      reviewComments={composer.reviewComments}
      onUpdateReviewComment={composer.updateReviewComment}
      onRemoveReviewComment={composer.removeReviewComment}
      runtimeConfigurations={runtimeConfigurations}
      sessionRuntimeConfigurationId={active.runtimeConfigurationId}
      runtimeDelegation={composer.runtimeDelegation}
      onRuntimeDelegationChange={composer.setRuntimeDelegation}
      controlSelection={composer.controlSelection}
      onControlSelectionChange={composer.setControlSelection}
      runtimeActions={composer.runtimeActions}
      onRuntimeActionsChange={composer.setRuntimeActions}
      workflowSelection={composer.workflowSelection}
      onWorkflowSelectionChange={composer.setWorkflowSelection}
      onSend={() => void composer.send()}
      assistantActive={assistantActive}
      aborting={aborting}
      onAbort={() => void handleAbort()}
      queueCount={queueCount}
      runtime={active.runtime}
      runtimeConfigurationName={activeRuntimeConfigurationName}
      model={active.model}
      effort={active.reasoningEffort}
      runtimeAccessMode={runtimeAccessModeFor(active)}
      onModelChange={(model, runtimeConfigurationId) =>
        patchComposerSetting(
          () =>
            patchSession(active.id, {
              model,
              ...(runtimeConfigurationId ? { runtimeConfigurationId } : {}),
            }),
          showToast,
          "Could not update model",
        )
      }
      onEffortChange={(reasoningEffort) =>
        patchComposerSetting(
          () => patchSession(active.id, { reasoningEffort }),
          showToast,
          "Could not update reasoning effort",
        )
      }
      onRuntimeAccessModeChange={(runtimeAccessMode) =>
        patchComposerSetting(
          () => patchSession(active.id, { runtimeAccessMode }),
          showToast,
          "Could not update access mode",
        )
      }
      fastMode={active.fastMode}
      supportsFastMode={sessionSupportsFastMode(active, runtimeConfigurations)}
      onToggleFastMode={() => {
        const previousFastMode = active.fastMode;
        const nextFastMode = !previousFastMode;
        setDetail((current) =>
          current?.id === active.id ? { ...current, fastMode: nextFastMode } : current,
        );
        void patchSession(active.id, { fastMode: nextFastMode }).catch((error: unknown) => {
          setDetail((current) =>
            current?.id === active.id && current.fastMode === nextFastMode
              ? { ...current, fastMode: previousFastMode }
              : current,
          );
          showToast(error instanceof Error ? error.message : "Could not update fast mode");
        });
      }}
      connected={connected}
      termOpen={termOpen}
      onToggleTerm={() => setTermOpen((open) => !open)}
      images={composer.pendingImages}
      documents={composer.pendingDocuments}
      pastes={composer.pastes}
      onPastesChange={composer.setPastes}
      attachDisabled={false}
      onAttachImages={(files) => void composer.attachImages(files)}
      onPasteImages={(items) => void composer.pasteImages(items)}
      onRemoveImage={composer.removeImage}
      onRemoveDocument={composer.removeDocument}
      onRuntimeConfigMenu={(event) =>
        setMenu({ kind: "cconfig", anchor: readAnchorRect(event) ?? new DOMRect() })
      }
      plusMenu={{
        onAttachImage: () => composer.imageInputRef.current?.click(),
        imageDisabled: composer.imageLimitReached,
        onAttachDocument: () => composer.documentInputRef.current?.click(),
        documentDisabled: composer.documentLimitReached,
        onImportSkill:
          skills && skills.length > 0
            ? () =>
                setMenu({
                  kind: "cskills",
                  anchor:
                    document
                      .querySelector('[data-testid="composer-plus"]')
                      ?.getBoundingClientRect() ?? new DOMRect(),
                })
            : undefined,
      }}
      onSlashPick={composer.setInput}
      workers={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
      workflows={workflowOptions}
      repos={repos}
      defaultWorkerId={active.defaultWorkerId ?? null}
      defaultWorkflowId={active.defaultWorkflowId ?? null}
      onDefaultWorkerChange={(workerId) => {
        void patchSession(active.id, { defaultWorkerId: workerId });
      }}
      onDefaultWorkflowChange={(workflowId) => {
        void patchSession(active.id, { defaultWorkflowId: workflowId });
      }}
      workflowArmed={composer.workflowArmed}
      onWorkflowArmedChange={composer.setWorkflowArmed}
      workflowRun={view.workflowRun}
      termLines={termLines}
      termInput={termInput}
      onTermInput={setTermInput}
      onTermRun={handleTermRun}
      onTermClose={() => setTermOpen(false)}
      repoPath={active.repoPath}
      worktreePath={active.workspacePath}
      branch={sessionGitStatus?.branch ?? null}
      onListBranches={listActiveSessionBranches}
      onBranchChange={switchActiveSessionBranch}
      gitDiffstat={diffstatForComposer(sessionGitStatus)}
      onDiffstatClick={() => openRightPanel("diff")}
      onOpenTasks={() => openRightPanel("tasks")}
      tasksCount={tasksBadge}
      gitPrControls={gitPrControls}
      mergedPrBar={mergedPrBar}
      suggestedWorktreeBranch={suggestSessionBranchName(active.title, active.id)}
      onCreateWorktree={worktreeCreateHandler(active.repoId, active.id, handleCreateWorktree)}
      onCommit={createSessionCommitHandler(active, showToast, setWorkspaceRefreshToken)}
      onToast={showToast}
    />
  );
};
