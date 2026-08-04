import {
  defaultDelegationSelectionFromConfiguration,
  formatWorkflowRuntimeModelLabel,
  normalizeDelegationSelectionWithConfiguration,
  RUNTIME_DELEGATIONS,
  type RuntimeConfigurationProvider,
  type RuntimeDelegationId,
  type RuntimeDelegationSelection,
  runtimeConfigurationToDelegationId,
  type WorkflowRuntimeReasoning,
} from "@aop/common";
import type { KeyboardEvent } from "react";
import { useLayoutEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { ComposerActionChip, formatActionModelSummary } from "./composer-action-chip";
import type { MentionToken } from "./composer-highlights";
import {
  reasoningForConfiguredModelChange,
  resolveRuntimePickOptions,
} from "./composer-runtime-options";
import {
  findAllRuntimeDelegationCandidates,
  findRuntimeDelegationCandidate,
  type RuntimeDelegationCandidate,
} from "./typeahead";

interface DismissedSuggestion {
  key: string;
  input: string;
}

/**
 * Tracks the NL runtime-word suggestion for the composer header chip.
 * No longer paints inside the textarea — only drives the top action chip.
 */
export const useDelegationSuggestion = (
  input: string,
  caret: number,
  armed: RuntimeDelegationSelection | null | undefined,
  configurations?: RuntimeConfigurationProvider[],
): {
  suggestion: RuntimeDelegationCandidate | null;
  dismiss: () => void;
} => {
  const [dismissed, setDismissed] = useState<DismissedSuggestion | null>(null);
  const candidate = useMemo(
    () => findRuntimeDelegationCandidate(input, caret, configurations),
    [input, caret, configurations],
  );
  const key = candidate ? `${candidate.id}:${candidate.start}` : null;
  const suppressed =
    dismissed !== null &&
    key !== null &&
    dismissed.key === key &&
    isContinuousDraftEdit(dismissed.input, input);
  const suggestion = armed || !candidate || suppressed ? null : candidate;

  useLayoutEffect(() => {
    if (!dismissed) return;
    if (!key || dismissed.key !== key || !isContinuousDraftEdit(dismissed.input, input)) {
      setDismissed(null);
      return;
    }
    if (dismissed.input !== input) setDismissed({ key, input });
  }, [dismissed, key, input]);

  return {
    suggestion,
    dismiss: () => {
      if (key) setDismissed({ key, input });
    },
  };
};

/** True when the user is still editing the same draft (append/backspace), not a fresh mention. */
export const isContinuousDraftEdit = (previous: string, next: string): boolean =>
  next.startsWith(previous) || previous.startsWith(next);

/**
 * Keyboard: Tab no longer arms (header chip is the entry point).
 * Escape dismisses a visible suggestion so the chip goes away.
 */
export const handleDelegationSuggestionKey = ({
  event,
  suggestion,
  onArm: _onArm,
  onDismiss,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  suggestion: RuntimeDelegationCandidate | null;
  onArm: (selection: RuntimeDelegationSelection) => void;
  onDismiss: () => void;
  configurations?: RuntimeConfigurationProvider[];
}): "armed" | "dismissed" | "none" => {
  if (!suggestion) return "none";
  if (event.key === "Escape") {
    event.preventDefault();
    onDismiss();
    return "dismissed";
  }
  return "none";
};

/** Default model + thinking a delegation arms with before the user adjusts it. */
export const defaultDelegationSelection = (
  id: RuntimeDelegationId,
  tokenRange?: { start: number; end: number },
  configurations?: RuntimeConfigurationProvider[],
  runtimeConfigurationId?: string,
): RuntimeDelegationSelection =>
  defaultDelegationSelectionFromConfiguration(id, {
    tokenRange,
    configurations,
    runtimeConfigurationId,
  });

export const normalizeDelegationSelection = (
  selection: RuntimeDelegationSelection,
  configurations?: RuntimeConfigurationProvider[],
): RuntimeDelegationSelection =>
  normalizeDelegationSelectionWithConfiguration(selection, configurations);

/**
 * Resolve the draft range for an armed runtime token (still used for caret restore).
 */
export const resolveArmedDelegationHighlight = (
  draft: string,
  selection: RuntimeDelegationSelection,
): RuntimeDelegationCandidate | null => {
  const fromStored = highlightFromStoredRange(draft, selection);
  if (fromStored) return fromStored;
  return findMatchingDelegationOccurrence(draft, selection.id, selection.tokenStart);
};

/**
 * Caret after Confirm: immediately after the armed runtime word so the user can
 * keep typing the rest of the prompt (e.g. "codex" → "codex to review").
 */
export const caretAfterArmedDelegation = (
  draft: string,
  selection: RuntimeDelegationSelection,
): number => {
  const armed = resolveArmedDelegationHighlight(draft, selection);
  if (armed) return armed.end;
  if (selection.tokenEnd !== undefined) {
    return Math.min(Math.max(selection.tokenEnd, 0), draft.length);
  }
  return draft.length;
};

const highlightFromStoredRange = (
  draft: string,
  selection: RuntimeDelegationSelection,
): RuntimeDelegationCandidate | null => {
  const { tokenStart, tokenEnd } = selection;
  if (tokenStart === undefined || tokenEnd === undefined) return null;
  if (tokenStart < 0 || tokenEnd > draft.length || tokenEnd <= tokenStart) return null;
  const text = draft.slice(tokenStart, tokenEnd);
  const candidate = findRuntimeDelegationCandidate(text, text.length);
  if (!candidate || candidate.id !== selection.id) return null;
  return {
    ...candidate,
    start: tokenStart + candidate.start,
    end: tokenStart + candidate.end,
  };
};

const findMatchingDelegationOccurrence = (
  draft: string,
  id: RuntimeDelegationId,
  preferredStart?: number,
): RuntimeDelegationCandidate | null => {
  const matches = findAllRuntimeDelegationCandidates(draft).filter((item) => item.id === id);
  if (matches.length === 0) return null;
  if (preferredStart === undefined) return matches[matches.length - 1] ?? null;
  return matches.reduce((best, match) => {
    const bestDistance = Math.abs(best.start - preferredStart);
    const distance = Math.abs(match.start - preferredStart);
    return distance < bestDistance ? match : best;
  });
};

/**
 * Mentions only — runtime words and $control no longer receive highlight marks.
 * Action chips above the canvas are the sole visual for those intents.
 */
export const withDelegationHighlightTokens = (
  mentionTokens: MentionToken[],
  _input: {
    suggestion: RuntimeDelegationCandidate | null;
    selection: RuntimeDelegationSelection | null | undefined;
    draft: string;
  },
): MentionToken[] => mentionTokens.filter((token) => token.kind !== "control");

export const delegationLabelForId = (id: RuntimeDelegationId): string =>
  RUNTIME_DELEGATIONS.find((item) => item.id === id)?.label ?? id;

export const formatDelegationArmedSummary = (selection: RuntimeDelegationSelection): string => {
  const label = delegationLabelForId(selection.id);
  const details = formatActionModelSummary(
    formatWorkflowRuntimeModelLabel(selection.model),
    selection.reasoning,
    selection.fastMode === true,
  );
  return `Will delegate to ‘${label}’ using ${details}`;
};

/**
 * Header chip for runtime NL delegation:
 * - offer: "Delegate to Runtime" (click to configure)
 * - config: model / thinking / fast + Confirm
 * - armed: yellow summary card (click to re-open config)
 */
export const ComposerDelegationAction = ({
  suggestion,
  selection,
  confirmed,
  onArm,
  onChange,
  onConfirm,
  onReopen,
  onDismissSuggestion,
  configurations,
}: {
  suggestion: RuntimeDelegationCandidate | null;
  selection: RuntimeDelegationSelection | null;
  /** After Confirm, show the yellow summary instead of selectors. */
  confirmed: boolean;
  onArm: (selection: RuntimeDelegationSelection) => void;
  onChange: ((selection: RuntimeDelegationSelection | null) => void) | undefined;
  onConfirm: () => void;
  onReopen: () => void;
  onDismissSuggestion: () => void;
  configurations?: RuntimeConfigurationProvider[];
}) => {
  const cancelArmed = () => {
    onChange?.(null);
    // Suppress the offer chip for the same draft so X is not immediately undone.
    onDismissSuggestion();
  };

  if (selection) {
    if (confirmed) {
      return (
        <ComposerActionChip
          tone="armed"
          testId="composer-delegation-action"
          dismissLabel={`Cancel ${delegationLabelForId(selection.id)} delegation`}
          onDismiss={cancelArmed}
          onPrimaryClick={onReopen}
        >
          <span data-testid="composer-delegation-summary">
            {formatDelegationArmedSummary(selection)}
          </span>
        </ComposerActionChip>
      );
    }
    return (
      <ComposerActionChip
        tone="config"
        testId="composer-delegation-action"
        dismissLabel={`Cancel ${delegationLabelForId(selection.id)} delegation`}
        onDismiss={cancelArmed}
      >
        <ArmedDelegationControls
          selection={selection}
          onChange={(next) => onChange?.(next)}
          onConfirm={onConfirm}
          configurations={configurations}
        />
      </ComposerActionChip>
    );
  }

  if (!suggestion) return null;
  return (
    <ComposerActionChip
      tone="offer"
      testId="composer-delegation-action"
      dismissLabel={`Dismiss ${suggestion.label} delegation offer`}
      onDismiss={onDismissSuggestion}
      onPrimaryClick={() =>
        onArm(
          defaultDelegationSelection(
            suggestion.id,
            {
              start: suggestion.start,
              end: suggestion.end,
            },
            configurations,
            suggestion.runtimeConfigurationId,
          ),
        )
      }
    >
      <span data-testid="composer-delegation-offer">Delegate to “{suggestion.label}”</span>
    </ComposerActionChip>
  );
};

const ArmedDelegationControls = ({
  selection,
  onChange,
  onConfirm,
  configurations,
}: {
  selection: RuntimeDelegationSelection;
  onChange: (selection: RuntimeDelegationSelection | null) => void;
  onConfirm?: () => void;
  configurations?: RuntimeConfigurationProvider[];
}) => {
  const delegation = RUNTIME_DELEGATIONS.find((item) => item.id === selection.id);
  if (!delegation) return null;
  const options = resolveRuntimePickOptions(
    delegation.runtime,
    selection.model,
    configurations,
    selection.runtimeConfigurationId,
    (configuration) => runtimeConfigurationToDelegationId(configuration) === selection.id,
  );
  const label = options.configuration?.name ?? options.label ?? delegation.label;

  const changeModel = (model: string) =>
    onChange(
      normalizeDelegationSelection(
        {
          ...selection,
          model,
          reasoning: reasoningForConfiguredModelChange(
            options.configuration,
            model,
            selection.reasoning,
          ),
        },
        configurations,
      ),
    );

  return (
    <>
      <span className="font-semibold text-text" data-chip-control>
        {label}
      </span>
      <span data-chip-control>
        <Select value={selection.model} onValueChange={changeModel}>
          <SelectTrigger aria-label="Delegation model" className="h-7 min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top">
            {options.models.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      {options.thinkingOptions.length > 0 ? (
        <span data-chip-control>
          <Select
            value={selection.reasoning}
            onValueChange={(reasoning) =>
              onChange(
                normalizeDelegationSelection(
                  {
                    ...selection,
                    reasoning: reasoning as WorkflowRuntimeReasoning,
                  },
                  configurations,
                ),
              )
            }
          >
            <SelectTrigger aria-label="Delegation thinking" className="h-7 min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {options.thinkingOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      ) : null}
      {options.showFast ? (
        <label className="flex items-center gap-1.5 text-[11.5px] text-text" data-chip-control>
          <input
            type="checkbox"
            aria-label="Delegation fast mode"
            checked={selection.fastMode === true}
            onChange={(event) =>
              onChange(
                normalizeDelegationSelection(
                  {
                    ...selection,
                    fastMode: event.target.checked,
                  },
                  configurations,
                ),
              )
            }
          />
          Fast
        </label>
      ) : null}
      <button
        type="button"
        data-chip-control
        data-testid="composer-delegation-confirm"
        aria-label={`Confirm ${label} delegation`}
        title={`Confirm ${label} delegation`}
        onClick={() => onConfirm?.()}
        className="rounded-control border border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_22%,var(--color-surface))] px-2.5 py-1 text-[11.5px] font-semibold text-text"
      >
        Confirm
      </button>
    </>
  );
};
