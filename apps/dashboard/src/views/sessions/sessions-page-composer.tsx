import { readAnchorRect } from "@/ui/menu-panel";
import { ChatComposer } from "./ChatComposer";
import {
  patchComposerSetting,
  runtimeAccessModeFor,
  sessionSupportsFastMode,
} from "./sessions-page-internals";
import type { SessionsPageViewModel } from "./sessions-page-view";

/** The composer with its full chrome — extracted to keep the view flat. */
export const SessionsComposer = ({ view }: { view: SessionsPageViewModel }) => {
  const {
    aborting,
    active,
    activeRuntimeConfigurationName,
    assistantActive,
    composer,
    connected,
    handleAbort,
    mergedPrBar,
    patchSession,
    queueCount,
    repos,
    runtimeConfigurations,
    setDetail,
    setMenu,
    showToast,
    skills,
  } = view;

  if (!active) return null;

  return (
    <ChatComposer
      input={composer.input}
      onInput={composer.setInput}
      reviewComments={composer.reviewComments}
      onUpdateReviewComment={composer.updateReviewComment}
      onRemoveReviewComment={composer.removeReviewComment}
      runtimeConfigurations={runtimeConfigurations}
      sessionRuntimeConfigurationId={active.runtimeConfigurationId}
      onSend={() => void composer.send()}
      assistantActive={assistantActive}
      aborting={aborting}
      onAbort={() => void handleAbort()}
      queueCount={queueCount}
      runtime={active.runtime}
      runtimeConfigurationName={activeRuntimeConfigurationName}
      model={active.model}
      effort={active.reasoningEffort}
      modelLocked={active.messages.length > 0}
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
      repos={repos}
      mergedPrBar={mergedPrBar}
    />
  );
};
