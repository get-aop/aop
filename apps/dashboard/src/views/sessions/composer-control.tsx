import {
  CONTROL_COMMANDS,
  type ControlCommandSelection,
  controlCommandLabel,
  defaultControlSelection,
  formatWorkflowRuntimeModelLabel,
  normalizeControlSelection,
  type RuntimeConfigurationProvider,
  type WorkflowRuntimeReasoning,
} from "@aop/common";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { ComposerActionChip, formatActionModelSummary } from "./composer-action-chip";
import {
  reasoningForConfiguredModelChange,
  resolveRuntimePickOptions,
} from "./composer-runtime-options";

/**
 * Header chip for $control: config selectors → yellow armed summary.
 * Mirrors the runtime delegation action chip flow.
 */
export const ComposerControlAction = ({
  commandId,
  selection,
  onChange,
  onClear,
  configurations,
  preferredConfigurationId,
}: {
  commandId: ControlCommandSelection["id"] | null;
  selection: ControlCommandSelection | null;
  onChange: (selection: ControlCommandSelection | null) => void;
  /** Clears selection and removes the $control token from the composer draft. */
  onClear: () => void;
  configurations?: RuntimeConfigurationProvider[];
  /** Active session runtime profile when it matches the control provider. */
  preferredConfigurationId?: string | null;
}) => {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!commandId || selection?.id !== commandId) setConfirmed(false);
    syncControlSelection(commandId, selection, configurations, preferredConfigurationId, onChange);
  }, [commandId, onChange, selection, configurations, preferredConfigurationId]);

  if (!commandId || !selection || selection.id !== commandId) return null;
  const command = CONTROL_COMMANDS.find((item) => item.id === commandId);
  if (!command) return null;

  const label = controlCommandLabel(command);
  const options = resolveRuntimePickOptions(
    command.provider,
    selection.model,
    configurations,
    selection.runtimeConfigurationId,
  );
  const configurationLabel = options.label ? `${options.label} · ${label}` : label;

  const changeModel = (model: string) =>
    onChange(
      normalizeControlSelection(
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

  if (confirmed) {
    return (
      <ComposerActionChip
        tone="armed"
        testId="composer-control-action"
        dismissLabel={`Remove ${label} control`}
        onDismiss={onClear}
        onPrimaryClick={() => setConfirmed(false)}
      >
        <span data-testid="composer-control-summary">
          {formatControlArmedSummary(label, selection)}
        </span>
      </ComposerActionChip>
    );
  }

  return (
    <ComposerActionChip
      tone="config"
      testId="composer-control-action"
      dismissLabel={`Remove ${label} control`}
      onDismiss={onClear}
    >
      <span className="font-semibold text-text" data-chip-control>
        {configurationLabel}
      </span>
      <span data-chip-control>
        <Select value={selection.model} onValueChange={changeModel}>
          <SelectTrigger aria-label="Control model" className="h-7 min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
                normalizeControlSelection(
                  { ...selection, reasoning: reasoning as WorkflowRuntimeReasoning },
                  configurations,
                ),
              )
            }
          >
            <SelectTrigger aria-label="Control thinking" className="h-7 min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} data-chip-control>
          <Switch
            checked={selection.fastMode}
            onCheckedChange={(fastMode) =>
              onChange(normalizeControlSelection({ ...selection, fastMode }, configurations))
            }
            aria-label="Control fast mode"
          />
          <span aria-hidden="true">Fast</span>
        </span>
      ) : null}
      <button
        type="button"
        data-chip-control
        data-testid="composer-control-confirm"
        aria-label={`Confirm ${label} control`}
        title={`Confirm ${label} control`}
        onClick={() => setConfirmed(true)}
        className="rounded-control border border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_22%,var(--color-surface))] px-2.5 py-1 text-[11.5px] font-semibold text-text"
      >
        Confirm
      </button>
    </ComposerActionChip>
  );
};

const syncControlSelection = (
  commandId: ControlCommandSelection["id"] | null,
  selection: ControlCommandSelection | null,
  configurations: RuntimeConfigurationProvider[] | undefined,
  preferredConfigurationId: string | null | undefined,
  onChange: (selection: ControlCommandSelection | null) => void,
) => {
  if (!commandId) {
    if (selection) onChange(null);
    return;
  }
  if (selection?.id !== commandId) {
    onChange(defaultControlSelection(commandId, configurations, preferredConfigurationId));
    return;
  }
  const normalized = normalizeControlSelection(selection, configurations);
  if (controlSelectionChanged(selection, normalized)) onChange(normalized);
};

const controlSelectionChanged = (
  current: ControlCommandSelection,
  next: ControlCommandSelection,
): boolean =>
  next.model !== current.model ||
  next.reasoning !== current.reasoning ||
  next.fastMode !== current.fastMode ||
  next.runtimeConfigurationId !== current.runtimeConfigurationId;

export const formatControlArmedSummary = (
  label: string,
  selection: Pick<ControlCommandSelection, "model" | "reasoning" | "fastMode">,
): string => {
  const details = formatActionModelSummary(
    formatWorkflowRuntimeModelLabel(selection.model),
    selection.reasoning,
    selection.fastMode,
  );
  return `Will use ${label} with ${details}`;
};

/** @deprecated Prefer ComposerControlAction — alias for existing imports. */
export const ComposerControlSelection = ComposerControlAction;
