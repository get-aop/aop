import type { ClipboardEvent, KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type MentionToken, parseMentionTokens } from "./composer-highlights";
import {
  clipboardPlainText,
  handleComposerImagePaste,
  handleComposerKeyPipeline,
} from "./composer-keyboard";
import {
  createPasteEntry,
  findPasteTokenRanges,
  formatPasteToken,
  insertTokenAtSelection,
  shouldCollapsePaste,
} from "./composer-paste-collapse";
import { resizeComposerInput } from "./composer-shell";
import type { ChatComposerProps } from "./composer-types";
import { applySlashPickToDraft } from "./SlashCommandMenu";
import { getEffectiveCmd, matchSlashToken } from "./sessions-runtime";
import { applyTypeaheadInsert, matchTypeahead, type TypeaheadItem } from "./typeahead";

export const useChatComposerState = (props: ChatComposerProps) => {
  const {
    input,
    onInput,
    onSend,
    runtime,
    alias = null,
    images = [],
    documents = [],
    pastes = [],
    onPastesChange,
    onPasteImages,
    attachDisabled = false,
    repos = [],
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Default to end of draft so controlled mounts (e.g. input="/") open slash completion.
  const [caret, setCaret] = useState(() => input.length);
  const [typeaheadIndex, setTypeaheadIndex] = useState(-1);
  const [dismissedTypeahead, setDismissedTypeahead] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const previousInputRef = useRef(input);
  const localInputEditRef = useRef(false);
  const isComposingRef = useRef(false);

  useLayoutEffect(() => {
    if (previousInputRef.current === input) return;
    previousInputRef.current = input;
    if (localInputEditRef.current) {
      localInputEditRef.current = false;
      setCaret((current) => Math.min(current, input.length));
      return;
    }
    // Parent-driven draft replacement (session switch, slash restore, test rerender).
    setCaret(input.length);
  }, [input]);
  const ecmd = getEffectiveCmd(runtime, alias);
  const canSend =
    !!input.trim() ||
    images.length > 0 ||
    documents.length > 0 ||
    (props.reviewComments?.length ?? 0) > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when draft text changes so height tracks content
  useLayoutEffect(() => {
    // Never resize mid-composition: setSelectionRange aborts IME / dead-key input.
    if (isComposingRef.current) return;
    resizeComposerInput(textareaRef.current);
  }, [input]);

  useEffect(() => {
    if (!props.assistantActive || !props.onAbort || props.aborting) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onAbort?.();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [props.assistantActive, props.aborting, props.onAbort]);

  const matchedTypeahead = useMemo(
    () => matchTypeahead({ draft: input, caret, repos }),
    [input, caret, repos],
  );
  const typeaheadKey = matchedTypeahead
    ? `${matchedTypeahead.kind}:${matchedTypeahead.tokenStart}`
    : null;
  const typeahead = activeTypeahead(matchedTypeahead, typeaheadKey, dismissedTypeahead);
  const highlightTokens = useMemo(() => {
    const mentionTokens = parseMentionTokens(input, { repos });
    const pasteTokens: MentionToken[] = findPasteTokenRanges(input).map((range) => ({
      kind: "paste",
      start: range.start,
      end: range.end,
      id: `paste-${range.index}`,
      label: input.slice(range.start, range.end),
    }));
    return [...mentionTokens, ...pasteTokens];
  }, [input, repos]);

  const restoreCaret = (nextCaret: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const applyTypeahead = (item: TypeaheadItem) => {
    if (!typeahead) return;
    const next = applyTypeaheadInsert(input, typeahead.tokenStart, caret, item.insertText);
    localInputEditRef.current = true;
    onInput(next.draft);
    setCaret(next.caret);
    setTypeaheadIndex(-1);
    restoreCaret(next.caret);
  };

  const applySlashPick = (command: string) => {
    const next = applySlashPickToDraft(input, caret, command);
    localInputEditRef.current = true;
    onInput(next.draft);
    setCaret(next.caret);
    setSlashIndex(0);
    // Parent may still treat this as a full draft write (SessionsPage setInput).
    props.onSlashPick(next.draft);
    restoreCaret(next.caret);
  };

  // Dismiss is scoped to the active slash token identity, not the whole draft.
  const slashToken = matchSlashToken(input, caret);
  const slashTokenKey = slashToken ? `${slashToken.start}:${slashToken.query}` : null;
  const slashDismissed = slashTokenKey !== null && dismissedSlashKey === slashTokenKey;

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    handleComposerKeyPipeline({
      event,
      input,
      caret,
      slashIndex,
      setSlashIndex,
      applySlashPick,
      slashTokenKey,
      setDismissedSlashKey,
      typeaheadItems: typeahead?.items ?? [],
      typeaheadIndex,
      setTypeaheadIndex,
      applyTypeahead,
      typeaheadKey,
      setDismissedTypeahead,
      canSend,
      onSend,
    });

  return {
    caret,
    setCaret,
    typeaheadIndex,
    setTypeaheadIndex,
    slashIndex,
    setSlashIndex,
    slashDismissed,
    typeahead,
    highlightTokens,
    textareaRef,
    localInputEditRef,
    isComposingRef,
    ecmd,
    canSend,
    applyTypeahead,
    applySlashPick,
    handleKey,
    handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (handleComposerImagePaste(event, onPasteImages, attachDisabled)) return;
      if (!onPastesChange) return;
      const text = clipboardPlainText(event);
      if (!shouldCollapsePaste(text)) return;
      event.preventDefault();
      const entry = createPasteEntry(text, pastes);
      const token = formatPasteToken(entry.index, entry.lineCount);
      const el = textareaRef.current;
      const start = el?.selectionStart ?? caret;
      const end = el?.selectionEnd ?? caret;
      const { nextValue, nextCaret } = insertTokenAtSelection(input, start, end, token);
      localInputEditRef.current = true;
      onPastesChange([...pastes, entry]);
      onInput(nextValue);
      setCaret(nextCaret);
      restoreCaret(nextCaret);
    },
  };
};

const activeTypeahead = <T>(match: T, key: string | null, dismissed: string | null): T | null =>
  key === dismissed ? null : match;
