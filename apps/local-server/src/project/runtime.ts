import {
  BUILT_IN_RUNTIME_ID,
  type CliProvider,
  getDefaultRuntimeConfigurationModel,
  type ReasoningEffort,
  type RuntimeConfigurationModel,
  type RuntimeConfigurationProvider,
  type RuntimePreference,
  resolveRuntimeConfigurationReasoning,
} from "@aop/common";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";

/** The runtime columns of a chat session, decided from what a project setting asks for. */
export interface SessionRuntime {
  runtime: CliProvider;
  runtimeConfigurationId: string | null;
  runtimeAlias: string | null;
  /** Null is "use default": the run passes no `--model` and the CLI decides. */
  model: string | null;
  /** Null is "use default": the run passes no `--effort` and the CLI decides. */
  reasoningEffort: string | null;
}

/**
 * Turns a project's runtime preference into concrete session columns. The role runs on the
 * runtime configuration the project names; if that one is gone (or has no models left), on
 * `fallbackRuntimeId` (the host's default runtime), and then on the built-in Claude Code one. The
 * configuration supplies the command and, for a model or effort that is named, what it offers;
 * the engine re-applies it on every send, so a named model the configuration does not offer falls
 * back to its default model instead of failing a run. A null model or effort stays null: it means
 * "use default", so the run passes no flag and the CLI decides. Whether the command can run at
 * all is checked when a turn starts (runtime-configuration/readiness.ts), so a missing or logged
 * out runtime fails that turn with a reason instead of being swapped for another one here.
 */
export const resolveSessionRuntime = async (
  configurations: RuntimeConfigurationRepository,
  preference: RuntimePreference,
  fallbackRuntimeId: string = BUILT_IN_RUNTIME_ID,
): Promise<SessionRuntime> => {
  const configuration = pickConfiguration(await configurations.list(), [
    preference.runtimeId,
    fallbackRuntimeId,
    BUILT_IN_RUNTIME_ID,
  ]);
  const defaultModel = configuration && getDefaultRuntimeConfigurationModel(configuration.models);
  if (!configuration || !defaultModel) {
    return {
      runtime: preference.provider,
      runtimeConfigurationId: null,
      runtimeAlias: null,
      model: preference.model,
      reasoningEffort: preference.effort,
    };
  }

  const named =
    preference.model === null
      ? null
      : (configuration.models.find((candidate) => candidate.model === preference.model) ??
        defaultModel);
  return {
    runtime: configuration.driver,
    runtimeConfigurationId: configuration.id,
    runtimeAlias: configuration.command,
    model: named?.model ?? null,
    // With no model named, the configuration's default model stands in for the one the CLI picks.
    reasoningEffort: resolveEffort(preference.effort, named ?? defaultModel),
  };
};

// The first of `ids` that names a configuration with models; one without any cannot run a turn.
const pickConfiguration = (
  configurations: readonly RuntimeConfigurationProvider[],
  ids: readonly string[],
): RuntimeConfigurationProvider | undefined => {
  for (const id of ids) {
    const found = configurations.find((candidate) => candidate.id === id);
    if (found && found.models.length > 0) return found;
  }
  return undefined;
};

// The preferred effort when the model supports it, otherwise the model's own default. A model
// that lists no effort levels takes no effort flag at all.
const resolveEffort = (
  preferred: ReasoningEffort | null,
  model: Pick<RuntimeConfigurationModel, "thinkingLevels" | "defaultThinkingLevel">,
): string | null => {
  if (preferred === null || model.thinkingLevels.length === 0) return null;
  return model.thinkingLevels.includes(preferred)
    ? preferred
    : resolveRuntimeConfigurationReasoning(model.thinkingLevels, null, model.defaultThinkingLevel);
};
