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
  type RuntimeStatus,
} from "@aop/common";

export interface ModelOption {
  model: string;
  label: string;
  efforts: readonly ReasoningEffort[];
  isDefault: boolean;
}

/**
 * The models a role can name on its runtime: the one model list both the project's settings ›
 * Models and the coordinator's chips show. The runtime configuration supplies them, as it does
 * for a run; while the runtimes load (or for a runtime that is gone), the built-in catalog.
 */
export const modelOptions = (
  runtimeId: string,
  configurations: readonly RuntimeConfigurationProvider[],
): ModelOption[] => {
  const configuration = runtimeOf(runtimeId, configurations);
  if (configuration && configuration.models.length > 0) {
    return configuration.models.map((model) => ({
      model: model.model,
      label: model.description.trim() || formatRuntimeModelLabel(model.model),
      efforts: model.thinkingLevels,
      isDefault: model.isDefault,
    }));
  }
  const provider = configuration?.driver ?? "claude-code";
  return getRuntimeModelOptions(provider).map((model, index) => ({
    model,
    label: formatRuntimeModelLabel(model),
    efforts: getThinkingOptions(provider, model).map(({ value }) => value),
    isDefault: index === 0,
  }));
};

/** The runtime a role names; undefined while the runtimes load, or once it is gone. */
export const runtimeOf = (
  runtimeId: string,
  configurations: readonly RuntimeConfigurationProvider[],
): RuntimeConfigurationProvider | undefined =>
  configurations.find((configuration) => configuration.id === runtimeId);

export interface RuntimeChoice {
  id: string;
  name: string;
  ready: boolean;
  /** Why it cannot be picked; null when it can. */
  reason: string | null;
}

/**
 * Every runtime as a picker offers it, built-in first. One the host found not ready (its
 * command missing, logged out, no models) carries the reason and is shown but not offered.
 * Until the host's first look comes back (`statuses` null) none is offered, so a runtime that
 * cannot run is never picked in the moment before the look; a runtime the host has no status for
 * (the look failed) is offered.
 */
export const runtimeChoices = (
  configurations: readonly RuntimeConfigurationProvider[],
  statuses: Readonly<Record<string, RuntimeStatus>> | null,
): RuntimeChoice[] =>
  configurations.map((configuration) => {
    if (statuses === null) {
      return { id: configuration.id, name: configuration.name, ready: false, reason: CHECKING };
    }
    const status = statuses[configuration.id];
    return {
      id: configuration.id,
      name: configuration.name,
      ready: status?.ready ?? true,
      reason: status?.reason ?? null,
    };
  });

const CHECKING = "Checking whether it can run…";

/**
 * A role moved to another runtime. Its model goes back to "Use default", since the old runtime's
 * models need not exist on the new one; its effort stays only if the new runtime's default model
 * accepts it.
 */
export const changeRuntime = (
  preference: RuntimePreference,
  runtimeId: string,
  configurations: readonly RuntimeConfigurationProvider[],
): RuntimePreference => {
  const configuration = runtimeOf(runtimeId, configurations);
  const next: RuntimePreference = {
    ...preference,
    runtimeId,
    provider: configuration?.driver ?? preference.provider,
    model: null,
  };
  return keepAcceptedEffort(next, modelOptions(runtimeId, configurations));
};

/** A new model keeps the effort only if that model accepts it, otherwise the effort falls back to its default. */
export const changeModel = (
  preference: RuntimePreference,
  model: string | null,
  options: readonly ModelOption[],
): RuntimePreference => keepAcceptedEffort({ ...preference, model }, options);

const keepAcceptedEffort = (
  preference: RuntimePreference,
  options: readonly ModelOption[],
): RuntimePreference =>
  effortOptions(preference, options).some((option) => option.value === preference.effort)
    ? preference
    : { ...preference, effort: null };

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
