// Derived from T3 Code (https://github.com/pingdotgg/t3code), MIT, Copyright (c) 2026 T3 Tools Inc.
import { ComposerAttachmentStrip, ComposerToolbar } from "./composer-parts";
import { ComposerInputStack, TypeaheadSlot } from "./composer-shell";
import type { ChatComposerProps } from "./composer-types";
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
        <ComposerCanvas props={props} composer={composer} />
      </div>
    </div>
  );
};

type ComposerState = ReturnType<typeof useChatComposerState>;

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
