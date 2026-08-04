import type { ClipboardEvent, KeyboardEvent } from "react";
import { handleDelegationSuggestionKey } from "./composer-delegation";
import { handleTypeaheadKeys } from "./composer-typeahead";
import type { ChatComposerProps } from "./composer-types";
import { handleSlashCommandKeys } from "./SlashCommandMenu";
import type { RuntimeDelegationCandidate, TypeaheadItem } from "./typeahead";

/** True while an IME / dead-key composition is in progress (Enter commits the glyph, not send). */
export const isComposerComposing = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.nativeEvent.isComposing || event.key === "Process";

export const handleComposerSendKey = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  canSend: boolean,
  onSend: () => void,
) => {
  if (isComposerComposing(event)) return;
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (canSend) onSend();
};

/** Returns true when the paste was handled as image attachments. */
export const handleComposerImagePaste = (
  event: ClipboardEvent<HTMLTextAreaElement>,
  onPasteImages: ChatComposerProps["onPasteImages"],
  attachDisabled: boolean,
): boolean => {
  const items = event.clipboardData?.items;
  if (!items || !onPasteImages || attachDisabled) return false;
  if (![...items].some((item) => item.type.startsWith("image/"))) return false;
  event.preventDefault();
  onPasteImages(items);
  return true;
};

/** Plain text from the clipboard, if any. */
export const clipboardPlainText = (event: ClipboardEvent<HTMLTextAreaElement>): string =>
  event.clipboardData?.getData("text/plain") ?? "";

/** Shared priority: slash menu → typeahead → delegation suggestion → send. */
export const handleComposerKeyPipeline = (args: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  input: string;
  caret: number;
  slashIndex: number;
  setSlashIndex: (index: number) => void;
  applySlashPick: (command: string) => void;
  slashTokenKey: string | null;
  setDismissedSlashKey: (key: string | null) => void;
  typeaheadItems: TypeaheadItem[];
  typeaheadIndex: number;
  setTypeaheadIndex: (updater: (index: number) => number) => void;
  applyTypeahead: (item: TypeaheadItem) => void;
  typeaheadKey: string | null;
  setDismissedTypeahead: (key: string | null) => void;
  delegationSuggestion: RuntimeDelegationCandidate | null;
  onRuntimeDelegationChange: ChatComposerProps["onRuntimeDelegationChange"];
  dismissDelegation: () => void;
  runtimeConfigurations?: ChatComposerProps["runtimeConfigurations"];
  canSend: boolean;
  onSend: () => void;
}) => {
  // Let the browser finish IME composition before intercepting Enter/Tab/arrows.
  if (isComposerComposing(args.event)) return;
  // Typeahead / slash menus take precedence while open so Tab selects items.
  const slashHandled = handleSlashCommandKeys({
    event: args.event,
    input: args.input,
    caret: args.caret,
    activeIndex: args.slashIndex,
    setActiveIndex: args.setSlashIndex,
    onPick: args.applySlashPick,
    onDismiss: () => {
      if (args.slashTokenKey) args.setDismissedSlashKey(args.slashTokenKey);
    },
  });
  if (slashHandled) return;
  const handled = handleTypeaheadKeys({
    event: args.event,
    typeaheadItems: args.typeaheadItems,
    typeaheadIndex: args.typeaheadIndex,
    setTypeaheadIndex: args.setTypeaheadIndex,
    applyTypeahead: args.applyTypeahead,
    dismiss: () => args.setDismissedTypeahead(args.typeaheadKey),
  });
  if (handled) return;
  const delegationResult = handleDelegationSuggestionKey({
    event: args.event,
    suggestion: args.delegationSuggestion,
    onArm: (selection) => args.onRuntimeDelegationChange?.(selection),
    onDismiss: args.dismissDelegation,
    configurations: args.runtimeConfigurations,
  });
  if (delegationResult === "armed") return;
  handleComposerSendKey(args.event, args.canSend, args.onSend);
};
