import type { RuntimePreference, RuntimePreferenceInput } from "@aop/common";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";

export type RuntimeChoiceError = { code: "RUNTIME_NOT_FOUND"; runtimeId: string };

/**
 * Names the runtime a role runs on before it is stored. A runtime the client names must exist,
 * and the role takes its driver as its provider; a role sent without one keeps `fallbackId`: the
 * host's default for a new project, the runtime it already has for a change. Whether the runtime
 * is ready is not checked here: a turn on one that is not fails with the reason when it starts.
 */
export const chooseRuntime = async (
  configurations: RuntimeConfigurationRepository,
  sent: RuntimePreferenceInput,
  fallbackId: string,
): Promise<RuntimePreference | RuntimeChoiceError> => {
  if (sent.runtimeId === undefined) return { ...sent, runtimeId: fallbackId };
  const configuration = await configurations.get(sent.runtimeId);
  if (!configuration) return { code: "RUNTIME_NOT_FOUND", runtimeId: sent.runtimeId };
  return { ...sent, runtimeId: configuration.id, provider: configuration.driver };
};

export const isRuntimeChoiceError = (
  choice: RuntimePreference | RuntimeChoiceError,
): choice is RuntimeChoiceError => "code" in choice;
