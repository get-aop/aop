import {
  type CliProvider,
  formatRuntimeModelLabel,
  getRuntimeModelOptions,
  getThinkingLabel,
  getThinkingOptions,
  type ReasoningEffort,
  type ReportedRuntime,
  type RuntimeConfigurationProvider,
  type RuntimePreference,
} from "@aop/common";

export interface ModelOption {
  model: string;
  label: string;
  efforts: readonly ReasoningEffort[];
  isDefault: boolean;
}

/**
 * The models a project setting can name for a provider. The host runs a role on the first
 * runnable configuration of the provider (it supplies the command and the models), so those
 * are the choices; with none configured, the provider's built-in catalog.
 */
export const modelOptions = (
  provider: CliProvider,
  configurations: readonly RuntimeConfigurationProvider[],
): ModelOption[] => {
  const configuration = configurations.find(
    (candidate) => candidate.driver === provider && candidate.models.length > 0,
  );
  if (configuration) {
    return configuration.models.map((model) => ({
      model: model.model,
      label: model.description.trim() || formatRuntimeModelLabel(model.model),
      efforts: model.thinkingLevels,
      isDefault: model.isDefault,
    }));
  }
  return getRuntimeModelOptions(provider).map((model, index) => ({
    model,
    label: formatRuntimeModelLabel(model),
    efforts: getThinkingOptions(provider, model).map(({ value }) => value),
    isDefault: index === 0,
  }));
};

/** The efforts the preferred model accepts; with no model chosen, those of the provider's default model. */
export const effortOptions = (
  preference: RuntimePreference,
  options: readonly ModelOption[],
): { value: ReasoningEffort; label: string }[] => {
  const model =
    options.find((option) => option.model === preference.model) ??
    options.find((option) => option.isDefault) ??
    options[0];
  return (model?.efforts ?? []).map((value) => ({
    value,
    label: getThinkingLabel(preference.provider, value),
  }));
};

const NOTHING_REPORTED: ReportedRuntime = { model: null, effort: null };

/**
 * A chip's model: the one the role names, or on "Use default" the one its last run reported
 * (what Claude Code picked), or "Default model" before any run has.
 */
export const modelLabel = (
  preference: RuntimePreference,
  options: readonly ModelOption[],
  reported: ReportedRuntime = NOTHING_REPORTED,
): string => {
  const model = preference.model ?? reported.model;
  return model === null ? "Default model" : nameOf(model, options);
};

/** A chip's effort, the same way: named, else reported, else "Default effort". */
export const effortLabel = (
  preference: RuntimePreference,
  reported: ReportedRuntime = NOTHING_REPORTED,
): string => {
  const effort = preference.effort ?? reported.effort;
  return effort === null ? "Default effort" : getThinkingLabel(preference.provider, effort);
};

/** "Use default" in a model picker: "Default (Opus 5.5)" once a run reported it, "Default" before. */
export const defaultModelLabel = (
  reported: ReportedRuntime,
  options: readonly ModelOption[] = [],
): string => (reported.model === null ? "Default" : `Default (${nameOf(reported.model, options)})`);

/** "Use default" in an effort picker: "Default (Low)" once a run reported it, "Default" before. */
export const defaultEffortLabel = (provider: CliProvider, reported: ReportedRuntime): string =>
  reported.effort === null ? "Default" : `Default (${getThinkingLabel(provider, reported.effort)})`;

const nameOf = (model: string, options: readonly ModelOption[]): string =>
  options.find((option) => option.model === model)?.label ?? formatRuntimeModelLabel(model);
