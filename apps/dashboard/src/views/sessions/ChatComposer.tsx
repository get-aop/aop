// Derived from T3 Code (https://github.com/pingdotgg/t3code), MIT, Copyright (c) 2026 T3 Tools Inc.
import { FlameIcon } from "lucide-react";
import { ComposerControlAction } from "./composer-control";
import { ComposerDelegationAction } from "./composer-delegation";
import { ComposerGitRow } from "./composer-git-row";
import { ComposerAttachmentStrip, ComposerToolbar } from "./composer-parts";
import {
  ComposerRuntimeActionCards,
  ComposerRuntimeActionPicker,
} from "./composer-runtime-actions";
import { ComposerInputStack, TypeaheadSlot } from "./composer-shell";
import type { ChatComposerProps } from "./composer-types";
import { ComposerWorkflowRail } from "./composer-workflow-chip";
import { ComposerWorkflowSelection } from "./composer-workflow-selection";
import { ComposerReviewQueueSlot } from "./SessionReviewQueueCards";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { useChatComposerState } from "./use-chat-composer-state";

export const ChatComposer = (props: ChatComposerProps) => {
  const composer = useChatComposerState(props);
  return (
    <div
      className={`chat-composer-divider${
        props.assistantActive ? " chat-composer-divider-active" : ""
      }`}
      data-testid="chat-composer"
      style={{
        flexShrink: 0,
        position: "relative",
        // No hard top border — the floating rounded card provides separation
        // (t3code composer language).
        background: "var(--color-canvas)",
        // Horizontal inset lives on .chat-column so the canvas lines up with
        // the thread (same max-width and padding).
        padding: "10px 0 18px",
      }}
    >
      <div
        className="chat-column"
        data-testid="chat-composer-column"
        style={{ position: "relative", padding: "0 28px" }}
      >
        <SlashCommandMenu
          input={props.input}
          caret={composer.caret}
          dismissed={composer.slashDismissed}
          activeIndex={composer.slashIndex}
          onActiveIndexChange={composer.setSlashIndex}
          onPick={composer.applySlashPick}
        />
        {composer.typeahead ? (
          <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-[var(--z-menu)]">
            <TypeaheadSlot
              match={composer.typeahead}
              activeIndex={composer.typeaheadIndex}
              onActiveIndexChange={composer.setTypeaheadIndex}
              onPick={composer.applyTypeahead}
            />
          </div>
        ) : null}
        {composer.pendingRuntimeAction ? (
          <ComposerRuntimeActionPicker
            intent={composer.pendingRuntimeAction}
            configurations={(props.runtimeConfigurations ?? []).filter(
              (configuration) =>
                configuration.driver !== "custom" && configuration.models.length > 0,
            )}
            onPick={composer.applyRuntimeActionConfiguration}
            onCancel={() => composer.setPendingRuntimeAction(null)}
          />
        ) : null}
        <ComposerActionChipRow props={props} composer={composer} />
        <ComposerCanvas props={props} composer={composer} />
      </div>
    </div>
  );
};

type ComposerState = ReturnType<typeof useChatComposerState>;

const ComposerActionChipRow = ({
  props,
  composer,
}: {
  props: ChatComposerProps;
  composer: ComposerState;
}) => {
  if (!hasComposerAction(props, composer)) return null;

  return (
    <div className="composer-action-chip-row" data-testid="composer-action-chip-row">
      <ComposerDelegationAction
        suggestion={composer.delegation.suggestion}
        selection={props.runtimeDelegation ?? null}
        confirmed={composer.delegationConfirmed}
        onArm={(selection) => {
          props.onRuntimeDelegationChange?.(selection);
          composer.setDelegationConfirmed(false);
        }}
        onChange={props.onRuntimeDelegationChange}
        onConfirm={composer.confirmDelegationConfig}
        onReopen={() => composer.setDelegationConfirmed(false)}
        onDismissSuggestion={composer.delegation.dismiss}
        configurations={props.runtimeConfigurations}
      />
      {composer.controlCommand && props.onControlSelectionChange ? (
        <ComposerControlAction
          commandId={composer.controlCommand.id}
          selection={props.controlSelection ?? null}
          onChange={props.onControlSelectionChange}
          configurations={props.runtimeConfigurations}
          preferredConfigurationId={props.sessionRuntimeConfigurationId}
          onClear={() => {
            const commandId = composer.controlCommand?.id;
            props.onControlSelectionChange?.(null);
            if (commandId) props.onInput(stripControlMarker(props.input, commandId));
          }}
        />
      ) : null}
      {props.runtimeActions?.length && props.onRuntimeActionsChange ? (
        <ComposerRuntimeActionCards
          actions={props.runtimeActions}
          configurations={props.runtimeConfigurations ?? []}
          onChange={props.onRuntimeActionsChange}
        />
      ) : null}
      {props.workflowSelection && props.onWorkflowSelectionChange ? (
        <ComposerWorkflowSelection
          selection={props.workflowSelection}
          onRemove={() => props.onWorkflowSelectionChange?.(null)}
        />
      ) : null}
    </div>
  );
};

const hasComposerAction = (props: ChatComposerProps, composer: ComposerState): boolean =>
  Boolean(
    composer.delegation.suggestion ||
      props.runtimeDelegation ||
      composer.controlCommand ||
      props.runtimeActions?.length ||
      props.workflowSelection,
  );

const ComposerCanvas = ({
  props,
  composer,
}: {
  props: ChatComposerProps;
  composer: ComposerState;
}) => (
  // t3code ChatComposer frame: rounded card with backdrop-blur, no top chrome.
  <div
    className="group rounded-[22px] p-px transition-colors duration-200"
    data-testid="composer-canvas-frame"
  >
    <div
      className="rounded-composer border border-border-strong bg-input-surface shadow-2 transition-[background-color,border-color] duration-200 has-focus-visible:border-border-bold"
      data-testid="composer-canvas"
    >
      <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
        <ComposerAttachmentStrip
          images={props.images ?? []}
          documents={props.documents ?? []}
          onRemoveImage={props.onRemoveImage}
          onRemoveDocument={props.onRemoveDocument}
        />
        {props.mergedPrBar ?? null}
        <ComposerReviewQueueSlot props={props} />
        <ComposerWorkflowRail
          workflows={props.workflows}
          defaultWorkflowId={props.defaultWorkflowId ?? null}
          onChange={(workflowId) => props.onDefaultWorkflowChange?.(workflowId)}
          armed={props.workflowArmed}
          running={props.workflowRun !== null && props.workflowRun !== undefined}
          onArmedChange={props.onWorkflowArmedChange}
        />
        {props.workflowRun ? (
          <div
            data-testid="composer-workflow-running"
            className="mb-2 flex items-center gap-1.5 rounded-row border border-border bg-raised px-2 py-1 text-[12px] text-text"
          >
            <FlameIcon className="aop-flame-armed size-3 shrink-0" />
            <span className="truncate font-medium">{props.workflowRun.workflowName}</span>
            <span className="truncate text-text-subtle">
              step {Math.min(props.workflowRun.currentIndex + 1, props.workflowRun.stepCount)}/
              {props.workflowRun.stepCount} · {props.workflowRun.currentStepType}
            </span>
          </div>
        ) : null}
        <ComposerInputStack
          input={props.input}
          highlightTokens={composer.highlightTokens}
          textareaRef={composer.textareaRef}
          localInputEditRef={composer.localInputEditRef}
          isComposingRef={composer.isComposingRef}
          onInput={props.onInput}
          setCaret={composer.setCaret}
          setTypeaheadIndex={composer.setTypeaheadIndex}
          setSlashIndex={composer.setSlashIndex}
          onKeyDown={composer.handleKey}
          onPaste={composer.handlePaste}
          locked={props.workflowRun !== null && props.workflowRun !== undefined}
        />
        <QueuedMessageHelper count={props.queueCount ?? 0} />
      </div>
      <ComposerToolbar
        props={props}
        ecmd={composer.ecmd}
        canSend={composer.canSend}
        connected={props.connected}
      />
    </div>
    <ComposerGitRow props={props} />
  </div>
);

const QueuedMessageHelper = ({ count }: { count: number }) => {
  if (count === 0) return null;
  return (
    <div
      data-testid="queued-message-helper"
      role="status"
      className="mt-2 text-xs text-muted-foreground"
    >
      {count} queued {count === 1 ? "message" : "messages"} will send automatically.
    </div>
  );
};

/** Drop `$ID` / `$ID[...]` so clearing the pill does not immediately re-arm it. */
const stripControlMarker = (content: string, commandId: string): string =>
  content.replace(new RegExp(`\\$${commandId}\\b(?:\\[[^\\]]*\\])?[ \\t]?`, "gi"), "").trim();
