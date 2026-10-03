import type { Thread } from "@aop/common";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { applyEdit, draftOf, insertMention, type MentionDraft, markupOf } from "./mention-markup";
import {
  buildMentionIndex,
  type MentionIndex,
  type MentionResult,
  searchMentions,
} from "./mention-search";
import { mentionQueryAt } from "./mention-trigger";

/** The open picker: what was typed after the `@`, the threads it finds, and the one picked by Enter. */
export interface MentionPickerState {
  listId: string;
  query: string;
  results: readonly MentionResult[];
  active: number;
  optionId: (index: number) => string;
  pick: (index: number) => void;
  hover: (index: number) => void;
}

/**
 * @-mentions in a composer's textarea. The draft is kept as the message will be sent, mentions as
 * thread links; the box shows each as `@title` with a chip drawn behind it (`MentionHighlights`).
 * Typing `@` where a mention can start opens a picker of `threads`; arrows move in it, Enter or
 * Tab picks, Escape closes it. Without `threads` nothing opens.
 */
export const useMentions = ({
  markup,
  setMarkup,
  threads,
  input,
}: {
  markup: string;
  setMarkup: (markup: string) => void;
  threads: readonly Thread[] | undefined;
  input: RefObject<HTMLTextAreaElement | null>;
}) => {
  const draft = useMemo(() => draftOf(markup), [markup]);
  const index = useMemo(() => (threads ? buildMentionIndex(threads) : null), [threads]);
  // Where the cursor is while the box has focus and nothing is selected; null otherwise.
  const [caret, setCaret] = useState<number | null>(null);
  // The `@` whose picker the person closed with Escape: it stays closed while they type after it.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [activeFor, setActiveFor] = useState({ key: "", index: 0 });
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  // A whole chip removed, or one inserted, leaves the cursor where the box cannot know to put it.
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !input.current) return;
    pendingCaret.current = null;
    input.current.setSelectionRange(at, at);
  });

  const { shown, results } = useShownQuery(index, draft, caret, dismissed);
  const key = shown ? `${shown.start}:${shown.query}` : "";
  const active =
    activeFor.key === key ? Math.max(0, Math.min(activeFor.index, results.length - 1)) : 0;

  const update = (next: { draft: MentionDraft; caret: number }, moveCaret: boolean) => {
    if (moveCaret) pendingCaret.current = next.caret;
    setMarkup(markupOf(next.draft));
    setCaret(next.caret);
    if (mentionQueryAt(next.draft, next.caret)?.start !== dismissed) setDismissed(null);
  };

  const pick = (at: number) => {
    const result = results[at];
    if (!shown || caret === null || !result) return;
    update(insertMention(draft, shown.start, caret, result.thread), true);
    input.current?.focus();
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const box = event.target;
    const typedCaret = box.selectionEnd ?? box.value.length;
    const next = applyEdit(draft, box.value, typedCaret);
    update(next, next.draft.text !== box.value || next.caret !== typedCaret);
  };

  const onSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const box = event.currentTarget;
    setCaret(box.selectionStart === box.selectionEnd ? box.selectionEnd : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!shown || event.nativeEvent.isComposing) return false;
    const handled = pickerKey(event.key, event.shiftKey, results.length, {
      move: (step) =>
        setActiveFor({ key, index: (active + step + results.length) % results.length }),
      pick: () => pick(active),
      close: () => setDismissed(shown.start),
    });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
    return handled;
  };

  const picker: MentionPickerState | null = shown
    ? {
        listId,
        query: shown.query,
        results,
        active,
        optionId: (at) => `${listId}-option-${at}`,
        pick,
        hover: (at) => setActiveFor({ key, index: at }),
      }
    : null;

  return {
    draft,
    picker,
    onChange,
    onSelect,
    // Back in the box, the cursor is where it was: no selection event says so.
    onFocus: onSelect,
    onBlur: () => setCaret(null),
    onKeyDown,
    ariaProps: ariaPropsOf(picker),
  };
};

/** The `@` whose picker is open, if one is, and the threads it finds. */
const useShownQuery = (
  index: MentionIndex | null,
  draft: MentionDraft,
  caret: number | null,
  dismissed: number | null,
) => {
  const trigger =
    index && caret !== null ? mentionQueryAt(draft, Math.min(caret, draft.text.length)) : null;
  const open = trigger && trigger.start !== dismissed ? trigger : null;
  const query = open?.query ?? null;
  const results = useMemo(
    () => (index && query !== null ? searchMentions(index, query) : []),
    [index, query],
  );
  // A query that found nothing and ended a word was not a mention after all.
  const shown = open && !(results.length === 0 && /\s$/.test(open.query)) ? open : null;
  return { shown, results };
};

/** Keys the open picker takes: arrows move, Enter (without Shift) or Tab picks, Escape closes. */
const pickerKey = (
  key: string,
  shift: boolean,
  count: number,
  act: { move: (step: number) => void; pick: () => void; close: () => void },
): boolean => {
  if (key === "Escape") {
    act.close();
    return true;
  }
  if (count === 0) return false;
  if (key === "ArrowDown" || key === "ArrowUp") {
    act.move(key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (key === "Tab" || (key === "Enter" && !shift)) {
    act.pick();
    return true;
  }
  return false;
};

// The box stays the focus while the picker is open: the option the arrows are on is announced
// through aria-activedescendant.
const ariaPropsOf = (picker: MentionPickerState | null) =>
  picker
    ? {
        "aria-autocomplete": "list" as const,
        "aria-controls": picker.listId,
        "aria-activedescendant":
          picker.results.length > 0 ? picker.optionId(picker.active) : undefined,
      }
    : { "aria-autocomplete": "list" as const };
