import type { ClipboardEvent, KeyboardEvent, MutableRefObject, RefObject } from "react";
import { ComposerHighlightLayer, type MentionToken } from "./composer-highlights";
import { TypeaheadPopover } from "./composer-typeahead";
import type { TypeaheadItem, TypeaheadMatch } from "./typeahead";

export const ComposerInputStack = ({
  input,
  highlightTokens,
  textareaRef,
  localInputEditRef,
  isComposingRef,
  onInput,
  setCaret,
  setTypeaheadIndex,
  setSlashIndex,
  onKeyDown,
  onPaste,
}: {
  input: string;
  highlightTokens: MentionToken[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  localInputEditRef: MutableRefObject<boolean>;
  isComposingRef: MutableRefObject<boolean>;
  onInput: (value: string) => void;
  setCaret: (value: number) => void;
  setTypeaheadIndex: (value: number) => void;
  setSlashIndex: (value: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) => (
  <div className="composer-input-stack">
    <ComposerHighlightLayer input={input} tokens={highlightTokens} textareaRef={textareaRef} />
    <textarea
      ref={textareaRef}
      data-testid="chat-composer-input"
      className="composer-input composer-text-surface chat-text-surface"
      value={input}
      onChange={(event) => {
        const value = event.target.value;
        // Capture selection before the controlled-state update can rerender the textarea.
        const nextCaret = event.target.selectionStart;
        // Height/selection restores abort IME composition (accents, smart quotes on macOS).
        if (!isComposingRef.current) {
          resizeComposerInput(event.currentTarget);
        }
        localInputEditRef.current = true;
        onInput(value);
        setCaret(typeof nextCaret === "number" ? nextCaret : value.length);
        setTypeaheadIndex(-1);
        setSlashIndex(0);
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        resizeComposerInput(event.currentTarget);
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
      }}
      onSelect={(event) =>
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
      }
      onKeyUp={(event) =>
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
      }
      onClick={(event) => {
        const nextCaret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
        setCaret(nextCaret);
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      rows={2}
      placeholder="Ask anything, ~ to mention a repository, or / for commands"
    />
  </div>
);

export const TypeaheadSlot = ({
  match,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: {
  match: TypeaheadMatch | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (item: TypeaheadItem) => void;
}) => {
  if (!match || match.items.length === 0) return null;
  return (
    <TypeaheadPopover
      items={match.items}
      activeIndex={activeIndex}
      onActiveIndexChange={onActiveIndexChange}
      onPick={onPick}
    />
  );
};

export const resizeComposerInput = (textarea: HTMLTextAreaElement | null): void => {
  if (!textarea) return;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  textarea.style.height = "auto";
  const contentHeight = Math.max(70, textarea.scrollHeight);
  textarea.style.height = `${contentHeight}px`;
  textarea.style.overflowX = "hidden";
  textarea.style.overflowY = "hidden";
  // Some engines move the caret while the height is collapsed to "auto".
  if (
    typeof selectionStart === "number" &&
    typeof selectionEnd === "number" &&
    (textarea.selectionStart !== selectionStart || textarea.selectionEnd !== selectionEnd)
  ) {
    textarea.setSelectionRange(selectionStart, selectionEnd);
  }
};
