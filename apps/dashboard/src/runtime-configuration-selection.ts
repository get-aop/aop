import type { RuntimeConfigurationProvider } from "@aop/common";

export const isRunnableRuntimeConfiguration = (
  configuration: RuntimeConfigurationProvider,
): boolean => configuration.models.length > 0;
