import {
  type CliProvider,
  getDefaultRuntimeConfigurationModel,
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
  /** Null is "use default": the run passes no `--model` and the CLI decides. */
  model: string | null;
  /** Null is "use default": the run passes no `--effort` and the CLI decides. */
  reasoningEffort: string | null;
}

/**
 * Turns a project's runtime preference into concrete session columns. A null model or effort
 * stays null: it means "use default", so the run passes no flag and Claude Code decides, and a
 * plan without AOP's catalog model still runs. The first runnable runtime configuration of the
 * provider supplies the command and, for a model or effort that is named, what it offers; the
 * engine re-applies that configuration on every send, so a named model the configuration does
 * not offer falls back to its default model instead of failing a run.
 */
export const resolveSessionRuntime = async (
  configurations: RuntimeConfigurationRepository,
  preference: RuntimePreference,
): Promise<SessionRuntime> => {
  const configuration = (await configurations.list()).find(
    (candidate) => candidate.driver === preference.provider && candidate.models.length > 0,
  );
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
    runtime: preference.provider,
    runtimeConfigurationId: configuration.id,
    runtimeAlias: configuration.command,
    model: named?.model ?? null,
    // With no model named, the configuration's default model stands in for the one the CLI picks.
    reasoningEffort: resolveEffort(preference.effort, named ?? defaultModel),
  };
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
