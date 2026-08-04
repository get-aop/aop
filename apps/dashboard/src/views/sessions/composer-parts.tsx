import type { ChatDocumentAttachment } from "@aop/common";
import { Attachment } from "@/ui/attachment";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import { ComposerFooter } from "./composer-footer";
import type { ChatComposerProps } from "./composer-types";
import { ComposerWorkflowChip } from "./composer-workflow-chip";
import { EFFORT_OPTIONS, getEffortLabel, getModelLabel, getRuntimeUi } from "./sessions-runtime";

export const ComposerAttachmentStrip = ({
  images,
  documents,
  onRemoveImage,
  onRemoveDocument,
}: {
  images: LocalCreateTaskImage[];
  documents: ChatDocumentAttachment[];
  onRemoveImage?: (id: string) => void;
  onRemoveDocument?: (id: string) => void;
}) => {
  if (images.length === 0 && documents.length === 0) return null;
  return (
    <div data-testid="chat-composer-attachments" className="mb-3 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <div
          key={image.id}
          className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
        >
          <img
            src={image.previewUrl}
            alt={`Attachment ${index + 1}`}
            className="h-full w-full object-cover"
          />
          {onRemoveImage ? (
            <RemoveAttachmentButton
              label={`Remove image ${index + 1}`}
              onClick={() => onRemoveImage(image.id)}
              overlay
            />
          ) : null}
        </div>
      ))}
      {documents.map((document) => (
        <Attachment
          key={document.id}
          data-testid="chat-composer-document"
          name={document.fileName}
          state="done"
          className="font-mono"
          onRemove={onRemoveDocument ? () => onRemoveDocument(document.id) : undefined}
        />
      ))}
    </div>
  );
};

export const ComposerToolbar = ({
  props,
  canSend,
  connected,
}: {
  props: ChatComposerProps;
  ecmd: string;
  canSend: boolean;
  connected: boolean;
}) => {
  const runtime = getRuntimeUi(props.runtime);
  const runtimeLabel = props.runtimeConfigurationName ?? runtime.label;
  const modelLabel = `${runtimeLabel} ${getModelLabel(props.model)}`;
  const effortLabel = getEffortLabel(props.runtime, props.effort, props.model);
  const configuration = props.runtimeConfigurations?.find(
    (item) => item.id === props.sessionRuntimeConfigurationId,
  );
  const configuredModel = configuration?.models.find((item) => item.model === props.model);
  const effortOptions = EFFORT_OPTIONS.filter(
    (option) => !configuredModel || configuredModel.thinkingLevels.includes(option.value),
  ).map((option) => ({
    value: option.value,
    label: getEffortLabel(props.runtime, option.value, props.model),
  }));
  const showAccessMode = configuration
    ? configuration.driver !== "custom"
    : props.runtime !== "custom";

  return (
    <div className="flex min-w-0 items-end">
      <div className="min-w-0 flex-1">
        <ComposerFooter
          runtime={props.runtime}
          runtimeConfigurationId={props.sessionRuntimeConfigurationId}
          runtimeConfigurations={props.runtimeConfigurations ?? []}
          model={props.model}
          modelLabel={modelLabel}
          effort={props.effort}
          effortLabel={effortLabel}
          effortOptions={effortOptions}
          accessMode={props.runtimeAccessMode ?? "full-access"}
          showAccessMode={showAccessMode}
          connected={connected}
          assistantActive={props.assistantActive === true}
          aborting={props.aborting === true}
          canSend={canSend}
          supportsFastMode={props.supportsFastMode === true}
          fastMode={props.fastMode === true}
          onModelChange={props.onModelChange}
          onEffortChange={props.onEffortChange}
          onAccessModeChange={props.onRuntimeAccessModeChange}
          onToggleFastMode={props.onToggleFastMode}
          plusMenu={props.plusMenu}
          workflowChip={
            props.defaultWorkflowId !== undefined ? (
              <ComposerWorkflowChip
                workflows={props.workflows}
                defaultWorkflowId={props.defaultWorkflowId ?? null}
                onChange={(workflowId) => props.onDefaultWorkflowChange?.(workflowId)}
              />
            ) : null
          }
          onSend={props.onSend}
          onAbort={props.onAbort}
        />
      </div>
      {props.assistantActive && canSend ? (
        <button
          type="button"
          aria-label="Queue message"
          title="Queue message"
          onClick={props.onSend}
          className="mb-2.5 mr-3 inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs transition-transform hover:scale-105"
        >
          Queue
        </button>
      ) : null}
    </div>
  );
};

const RemoveAttachmentButton = ({
  label,
  onClick,
  overlay = false,
}: {
  label: string;
  onClick: () => void;
  overlay?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={
      overlay
        ? "absolute right-1 top-1 grid size-5 place-items-center rounded-md bg-background/80 font-mono text-[11px] font-bold text-foreground hover:bg-background"
        : "grid size-5 place-items-center rounded-md font-mono text-[11px] font-bold text-foreground"
    }
  >
    ×
  </button>
);
