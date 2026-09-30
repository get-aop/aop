import {
  type CliProvider,
  getDefaultRuntimeConfigurationModel,
  getDefaultRuntimeModel,
  getDefaultRuntimeReasoning,
  type ReasoningEffort,
  type RuntimeConfigurationModel,
  type RuntimePreference,
  resolveRuntimeConfigurationReasoning,
} from "@aop/common";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";

/** The runtime columns of a chat session, decided from what a project setting asks for. */
export interface SessionRuntime {
  runtime: CliProvider;
  runtimeConfigurationId: string | null;
  runtimeAlias: string | null;
  model: string;
  reasoningEffort: string;
}

/**
 * Turns a project's runtime preference into concrete session columns. A null model or effort
 * means "the provider's default", resolved here so a session records what it will actually run.
 * The first runnable runtime configuration of the provider supplies the command and models;
 * the engine re-applies that configuration on every send, so a model the configuration does not
 * offer falls back to its default instead of failing a run.
 */
export const resolveSessionRuntime = async (
  configurations: RuntimeConfigurationRepository,
  preference: RuntimePreference,
): Promise<SessionRuntime> => {
  const configuration = (await configurations.list()).find(
    (candidate) => candidate.driver === preference.provider && candidate.models.length > 0,
  );
  if (!configuration) return catalogDefaults(preference);

  const model =
    configuration.models.find((candidate) => candidate.model === preference.model) ??
    getDefaultRuntimeConfigurationModel(configuration.models);
  return {
    runtime: preference.provider,
    runtimeConfigurationId: configuration.id,
    runtimeAlias: configuration.command,
    model: model?.model ?? getDefaultRuntimeModel(preference.provider, ""),
    reasoningEffort: model
      ? resolveEffort(preference.effort, model)
      : getDefaultRuntimeReasoning(preference.provider, "", "medium"),
  };
};

// No runtime configuration to take from: the provider's built-in catalog defaults.
const catalogDefaults = (preference: RuntimePreference): SessionRuntime => {
  const model = preference.model ?? getDefaultRuntimeModel(preference.provider, "");
  return {
    runtime: preference.provider,
    runtimeConfigurationId: null,
    runtimeAlias: null,
    model,
    reasoningEffort:
      preference.effort ?? getDefaultRuntimeReasoning(preference.provider, model, "medium"),
  };
};

// The preferred effort when the model supports it, otherwise the model's own default.
const resolveEffort = (
  preferred: ReasoningEffort | null,
  model: Pick<RuntimeConfigurationModel, "thinkingLevels" | "defaultThinkingLevel">,
): string =>
  preferred && model.thinkingLevels.includes(preferred)
    ? preferred
    : resolveRuntimeConfigurationReasoning(model.thinkingLevels, null, model.defaultThinkingLevel);
