import {
  type CliProvider,
  formatRuntimeModelLabel,
  getRuntimeModelOptions,
  getThinkingLabel,
  getThinkingOptions,
  type ReasoningEffort,
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

export const modelLabel = (
  preference: RuntimePreference,
  options: readonly ModelOption[],
): string => {
  if (preference.model === null) return "Default model";
  return (
    options.find((option) => option.model === preference.model)?.label ??
    formatRuntimeModelLabel(preference.model)
  );
};

export const effortLabel = (preference: RuntimePreference): string =>
  preference.effort === null
    ? "Default effort"
    : getThinkingLabel(preference.provider, preference.effort);
