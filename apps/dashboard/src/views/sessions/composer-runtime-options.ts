/**
 * Shared model/thinking/fast option resolution for chat $control and %delegation.
 * Both surfaces use the canonical findRuntimeConfiguration helper.
 */
import {
  findRuntimeConfiguration,
  formatWorkflowRuntimeModelLabel,
  getWorkflowModelOptions,
  getWorkflowThinkingLabel,
  getWorkflowThinkingOptions,
  type RuntimeConfigurationModel,
  type RuntimeConfigurationProvider,
  resolveConfiguredModelRecord,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
  supportsFastMode,
  type WorkflowRuntimeProvider,
  type WorkflowRuntimeReasoning,
} from "@aop/common";

export interface RuntimePickOption {
  value: string;
  label: string;
}

export interface ResolvedRuntimePickOptions {
  configuration?: RuntimeConfigurationProvider;
  models: RuntimePickOption[];
  thinkingOptions: RuntimePickOption[];
  showFast: boolean;
  label?: string;
}

export const resolveRuntimePickOptions = (
  provider: WorkflowRuntimeProvider,
  model: string,
  configurations?: RuntimeConfigurationProvider[],
  runtimeConfigurationId?: string,
  /** Extra filter for PI vs OMP (delegation id mapping). */
  match?: (configuration: RuntimeConfigurationProvider) => boolean,
): ResolvedRuntimePickOptions => {
  const configuration = resolvePickConfiguration(
    provider,
    configurations,
    runtimeConfigurationId,
    match,
  );
  if (configuration) {
    const configuredModel = resolveConfiguredModelRecord(configuration, model);
    return {
      configuration,
      label: configuration.name,
      models: configuration.models.map((item) => ({
        value: item.model,
        label: item.description.trim() || formatWorkflowRuntimeModelLabel(item.model),
      })),
      thinkingOptions: (configuredModel?.thinkingLevels ?? []).map((value) => ({
        value,
        label: getWorkflowThinkingLabel(provider, value, model),
      })),
      showFast: runtimeConfigurationSupportsFastMode(configuration, model),
    };
  }

  return {
    models: getWorkflowModelOptions(provider).map((value) => ({
      value,
      label: formatWorkflowRuntimeModelLabel(value),
    })),
    thinkingOptions: getWorkflowThinkingOptions(provider, model).map((option) => ({
      value: option.value,
      label: option.label,
    })),
    showFast: supportsFastMode(provider, model),
  };
};

const resolvePickConfiguration = (
  provider: WorkflowRuntimeProvider,
  configurations: RuntimeConfigurationProvider[] | undefined,
  runtimeConfigurationId: string | undefined,
  match?: (configuration: RuntimeConfigurationProvider) => boolean,
): RuntimeConfigurationProvider | undefined => {
  if (runtimeConfigurationId) {
    const preferred = findRuntimeConfiguration(configurations, {
      preferredId: runtimeConfigurationId,
    });
    if (preferred && preferred.driver === provider) return preferred;
  }
  return findRuntimeConfiguration(configurations, { driver: provider, match });
};

export const reasoningForConfiguredModelChange = (
  configuration: RuntimeConfigurationProvider | undefined,
  model: string,
  fallbackReasoning: WorkflowRuntimeReasoning,
): WorkflowRuntimeReasoning => {
  const nextModel = resolveConfiguredModelRecord(configuration, model) as
    | RuntimeConfigurationModel
    | undefined;
  if (!nextModel) return fallbackReasoning;
  return resolveRuntimeConfigurationReasoning(
    nextModel.thinkingLevels,
    null,
    nextModel.defaultThinkingLevel,
  );
};
