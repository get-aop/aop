import {
  applyRuntimeConfigurationToAgent,
  type RuntimeConfigurationProvider,
  type StepAgent,
} from "@aop/common";

export const isRunnableRuntimeConfiguration = (
  configuration: RuntimeConfigurationProvider,
): boolean => configuration.driver !== "custom" && configuration.models.length > 0;

export const selectedRuntimeConfiguration = (
  agent: StepAgent,
  configurations: RuntimeConfigurationProvider[],
): RuntimeConfigurationProvider | undefined =>
  agent.runtimeConfigurationId
    ? configurations.find((configuration) => configuration.id === agent.runtimeConfigurationId)
    : configurations.find((configuration) => configuration.id === agent.provider);

export const applyRuntimeConfiguration = (
  agent: StepAgent,
  configuration: RuntimeConfigurationProvider,
): StepAgent => {
  return applyRuntimeConfigurationToAgent(agent, configuration) ?? agent;
};
