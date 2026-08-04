import { CONTROL_COMMANDS } from "@aop/common";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  caretAfterArmedDelegation,
  defaultDelegationSelection,
  useDelegationSuggestion,
  withDelegationHighlightTokens,
} from "./composer-delegation";
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
import {
  addRuntimeAction,
  createRuntimeAction,
  quickActionIntent,
} from "./composer-runtime-actions";
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
    workers = [],
    workflows = [],
    repos = [],
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Default to end of draft so controlled mounts (e.g. input="/") open slash completion.
  const [caret, setCaret] = useState(() => input.length);
  const [typeaheadIndex, setTypeaheadIndex] = useState(-1);
  const [dismissedTypeahead, setDismissedTypeahead] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const [delegationConfirmed, setDelegationConfirmed] = useState(false);
  const [pendingRuntimeAction, setPendingRuntimeAction] = useState<
    import("@aop/common").ChatRuntimeActionIntent | null
  >(null);
  const previousInputRef = useRef(input);
  const localInputEditRef = useRef(false);
  const isComposingRef = useRef(false);
  const previousDelegationKeyRef = useRef<string | null>(null);

  // New armed selection opens the config chip (not yet confirmed).
  useEffect(() => {
    const selection = props.runtimeDelegation;
    if (!selection) {
      previousDelegationKeyRef.current = null;
      setDelegationConfirmed(false);
      return;
    }
    const key = `${selection.id}:${selection.tokenStart ?? ""}:${selection.tokenEnd ?? ""}`;
    if (previousDelegationKeyRef.current !== key) {
      previousDelegationKeyRef.current = key;
      setDelegationConfirmed(false);
    }
  }, [props.runtimeDelegation]);

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
    !props.workflowRun &&
    (!!input.trim() ||
      images.length > 0 ||
      documents.length > 0 ||
      (props.reviewComments?.length ?? 0) > 0);

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
    () =>
      matchTypeahead({
        draft: input,
        caret,
        workers,
        workflows,
        repos,
        runtimeConfigurations: props.runtimeConfigurations,
      }),
    [input, caret, workers, workflows, repos, props.runtimeConfigurations],
  );
  const typeaheadKey = matchedTypeahead
    ? `${matchedTypeahead.kind}:${matchedTypeahead.tokenStart}`
    : null;
  const typeahead = activeTypeahead(matchedTypeahead, typeaheadKey, dismissedTypeahead);
  const mentionTokens = useMemo(
    () =>
      parseMentionTokens(input, {
        workers,
        workflows: workflows.map((workflow) =>
          typeof workflow === "string" ? workflow : workflow.name,
        ),
        repos,
      }),
    [input, workers, workflows, repos],
  );
  const controlCommand = findControlCommand(mentionTokens);
  const delegation = useDelegationSuggestion(
    input,
    caret,
    props.runtimeDelegation,
    props.runtimeConfigurations,
  );
  const highlightTokens = useMemo(() => {
    const mentionAndDelegation = withDelegationHighlightTokens(mentionTokens, {
      suggestion: delegation.suggestion,
      selection: props.runtimeDelegation ?? null,
      draft: input,
    });
    const pasteTokens: MentionToken[] = findPasteTokenRanges(input).map((range) => ({
      kind: "paste",
      start: range.start,
      end: range.end,
      id: `paste-${range.index}`,
      label: input.slice(range.start, range.end),
    }));
    return [...mentionAndDelegation, ...pasteTokens];
  }, [mentionTokens, delegation.suggestion, props.runtimeDelegation, input]);

  const restoreCaret = (nextCaret: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  /** Collapse config to the yellow summary and put the caret back after the runtime word. */
  const confirmDelegationConfig = () => {
    setDelegationConfirmed(true);
    const selection = props.runtimeDelegation;
    if (!selection) {
      restoreCaret(caret);
      return;
    }
    const nextCaret = caretAfterArmedDelegation(input, selection);
    setCaret(nextCaret);
    restoreCaret(nextCaret);
  };

  const applyTypeahead = (item: TypeaheadItem) => {
    if (!typeahead) return;
    if (
      item.kind === "workflow" &&
      props.runtimeActions?.length &&
      !window.confirm("Replace the current Quick Actions with this workflow?")
    ) {
      return;
    }
    const next = applyTypeaheadInsert(input, typeahead.tokenStart, caret, item.insertText);
    localInputEditRef.current = true;
    onInput(next.draft);
    setCaret(next.caret);
    setTypeaheadIndex(-1);
    applyRuntimeTypeahead(item, typeahead.tokenStart);
    applyWorkflowTypeahead(item);
    restoreCaret(next.caret);
  };

  const applyRuntimeTypeahead = (item: TypeaheadItem, tokenStart: number) => {
    if (item.kind !== "runtime" || !item.runtimeId) return;
    const inserted = item.insertText.replace(/\s+$/, "");
    props.onRuntimeDelegationChange?.(
      defaultDelegationSelection(
        item.runtimeId,
        { start: tokenStart, end: tokenStart + inserted.length },
        props.runtimeConfigurations,
        item.runtimeConfigurationId,
      ),
    );
    setDelegationConfirmed(false);
  };

  const applyWorkflowTypeahead = (item: TypeaheadItem) => {
    if (item.kind !== "workflow" || !item.workflow) return;
    props.onRuntimeActionsChange?.([]);
    props.onWorkflowSelectionChange?.({
      workflowId: item.workflow.id,
      name: item.workflow.name,
      stepCount: item.workflow.stepCount,
      stepTypes: item.workflow.stepTypes,
      steps: item.workflow.steps,
    });
  };

  const applySlashPick = (command: string) => {
    const intent = quickActionIntent(command);
    const next = applySlashPickToDraft(input, caret, intent ? "" : command);
    localInputEditRef.current = true;
    onInput(next.draft);
    setCaret(next.caret);
    setSlashIndex(0);
    // Parent may still treat this as a full draft write (SessionsPage setInput).
    props.onSlashPick(next.draft);
    if (intent) setPendingRuntimeAction(intent);
    restoreCaret(next.caret);
  };

  const applyRuntimeActionConfiguration = (
    configuration: import("@aop/common").RuntimeConfigurationProvider,
  ) => {
    if (!pendingRuntimeAction || !props.onRuntimeActionsChange) return;
    if (
      props.workflowSelection &&
      !window.confirm("Replace the selected workflow with Quick Actions?")
    ) {
      setPendingRuntimeAction(null);
      restoreCaret(caret);
      return;
    }
    const action = createRuntimeAction(pendingRuntimeAction, configuration);
    if (!action) return;
    props.onWorkflowSelectionChange?.(null);
    props.onRuntimeActionsChange(addRuntimeAction(props.runtimeActions ?? [], action));
    setPendingRuntimeAction(null);
    restoreCaret(caret);
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
      delegationSuggestion: delegation.suggestion,
      onRuntimeDelegationChange: props.onRuntimeDelegationChange,
      dismissDelegation: delegation.dismiss,
      runtimeConfigurations: props.runtimeConfigurations,
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
    controlCommand,
    delegation,
    delegationConfirmed,
    setDelegationConfirmed,
    confirmDelegationConfig,
    textareaRef,
    localInputEditRef,
    isComposingRef,
    ecmd,
    canSend,
    pendingRuntimeAction,
    setPendingRuntimeAction,
    applyRuntimeActionConfiguration,
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

const findControlCommand = (tokens: MentionToken[]) =>
  CONTROL_COMMANDS.find((command) =>
    tokens.some((token) => token.kind === "control" && token.id === command.id),
  );
