import { z } from "zod";
import type { StepAgent } from "../protocol/index.ts";
import {
  applyWorkflowRuntimeProviderDefaults,
  formatWorkflowRuntimeModelLabel,
  getDefaultWorkflowRuntimeModel,
  getDefaultWorkflowRuntimeReasoning,
  getWorkflowModelOptions,
  getWorkflowThinkingOptions,
  isWorkflowRuntimeProvider,
  SAFE_CUSTOM_RUNTIME_MODEL_PATTERN,
  supportsFastMode,
  supportsThinkingLevel,
  WORKFLOW_RUNTIME_OPTIONS,
  type WorkflowRuntimeProvider,
  type WorkflowRuntimeReasoning,
} from "./workflow-runtime.ts";

export const RuntimeThinkingLevelSchema = z.enum(["low", "medium", "high", "extra-high", "max"]);
export type RuntimeThinkingLevel = z.infer<typeof RuntimeThinkingLevelSchema>;

export const RuntimeDriverSchema = z.enum([
  "claude-code",
  "codex-cli",
  "grok-build",
  "opencode",
  "pi",
  "custom",
]);
export type RuntimeDriver = z.infer<typeof RuntimeDriverSchema>;

export const RuntimeConfigurationProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  command: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/-]+$/, "Executable must be a single command token"),
  driver: RuntimeDriverSchema.default("custom"),
});
export type RuntimeConfigurationProviderInput = z.infer<
  typeof RuntimeConfigurationProviderInputSchema
>;

export const RuntimeConfigurationModelInputSchema = z.object({
  description: z.string().trim().min(1).max(100),
  model: z
    .string()
    .trim()
    .regex(SAFE_CUSTOM_RUNTIME_MODEL_PATTERN, "Model must be a valid identifier"),
  thinkingLevels: z.array(RuntimeThinkingLevelSchema),
});
export type RuntimeConfigurationModelInput = z.infer<typeof RuntimeConfigurationModelInputSchema>;

export interface RuntimeConfigurationModel extends RuntimeConfigurationModelInput {
  id: string;
  providerId: string;
  builtIn: boolean;
  position: number;
  isDefault: boolean;
  /** Preferred thinking level shown in chat/workflow/delegation UI for this model. */
  defaultThinkingLevel: RuntimeThinkingLevel | null;
}

export interface RuntimeConfigurationProvider extends RuntimeConfigurationProviderInput {
  id: string;
  builtIn: boolean;
  position: number;
  /** Whether this runtime exposes a Fast mode toggle in session/workflow settings. */
  supportsFastMode: boolean;
  models: RuntimeConfigurationModel[];
}

export interface BuiltInRuntimeConfiguration
  extends Omit<RuntimeConfigurationProvider, "builtIn" | "models" | "position"> {
  id: WorkflowRuntimeProvider;
  driver: WorkflowRuntimeProvider;
  models: RuntimeConfigurationModelInput[];
}

const RUNTIME_COMMANDS: Record<WorkflowRuntimeProvider, string> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  "grok-build": "grok",
  opencode: "opencode",
  pi: "pi",
};

/** Default Fast capability for a built-in runtime driver (not per-model). */
export const runtimeSupportsFastMode = (driver: RuntimeDriver | WorkflowRuntimeProvider): boolean =>
  driver === "claude-code" || driver === "codex-cli" || driver === "pi";

export const runtimeConfigurationSupportsFastMode = (
  configuration: Pick<RuntimeConfigurationProvider, "builtIn" | "driver" | "supportsFastMode">,
  model: string,
): boolean => {
  if (configuration.driver !== "claude-code") return configuration.supportsFastMode;
  if (!supportsFastMode("claude-code", model)) return false;
  return configuration.builtIn || configuration.supportsFastMode;
};

export const BUILT_IN_RUNTIME_CONFIGURATIONS: BuiltInRuntimeConfiguration[] =
  WORKFLOW_RUNTIME_OPTIONS.map(({ value: provider, label: name }) => ({
    id: provider,
    name,
    command: RUNTIME_COMMANDS[provider],
    driver: provider,
    supportsFastMode: runtimeSupportsFastMode(provider),
    models: getWorkflowModelOptions(provider).map((model) => ({
      description: formatWorkflowRuntimeModelLabel(model),
      model,
      thinkingLevels: supportsThinkingLevel(provider, model)
        ? getWorkflowThinkingOptions(provider, model).map((option) => option.value)
        : [],
    })),
  }));

export const applyRuntimeConfigurationToAgent = (
  agent: StepAgent,
  configuration: RuntimeConfigurationProvider,
): StepAgent | null => {
  if (!isWorkflowRuntimeProvider(configuration.driver)) return null;

  const defaults = applyWorkflowRuntimeProviderDefaults(agent, configuration.driver);
  const model = getDefaultRuntimeConfigurationModel(configuration.models);
  if (!model) return null;

  return {
    ...defaults,
    model: model.model,
    // Selecting a runtime always lands on that model's configured default thinking.
    reasoning: resolveRuntimeConfigurationReasoning(
      model.thinkingLevels,
      null,
      model.defaultThinkingLevel,
    ),
    fastMode: runtimeConfigurationSupportsFastMode(configuration, model.model)
      ? (agent.fastMode ?? false)
      : false,
    runtimeAlias: configuration.command,
    runtimeConfigurationId: configuration.id,
  };
};

export const getDefaultRuntimeConfigurationModel = <Model extends { isDefault: boolean }>(
  models: Model[],
): Model | undefined => models.find((model) => model.isDefault) ?? models[0];

/**
 * Pick reasoning for a runtime model. Prefer the configured default thinking
 * level (what settings marks as the AOP default), then a still-valid current
 * value, then the first available level.
 */
export const resolveRuntimeConfigurationReasoning = (
  levels: RuntimeThinkingLevel[],
  current: WorkflowRuntimeReasoning | null | undefined = null,
  defaultThinkingLevel: RuntimeThinkingLevel | null = null,
): WorkflowRuntimeReasoning =>
  (defaultThinkingLevel && levels.includes(defaultThinkingLevel)
    ? defaultThinkingLevel
    : undefined) ??
  (current && levels.includes(current as RuntimeThinkingLevel)
    ? (current as RuntimeThinkingLevel)
    : undefined) ??
  levels[0] ??
  "medium";

/** Normalize a stored default so it always refers to an enabled thinking level when possible. */
export const normalizeDefaultThinkingLevel = (
  levels: RuntimeThinkingLevel[],
  preferred: RuntimeThinkingLevel | null | undefined,
): RuntimeThinkingLevel | null => {
  if (levels.length === 0) return null;
  if (preferred && levels.includes(preferred)) return preferred;
  return levels[0] ?? null;
};

/**
 * Canonical runtime-configuration lookup for chat, workflow, %, and $.
 * Prefer an explicit id when present; otherwise first ordered match by driver/predicate.
 */
export const findRuntimeConfiguration = (
  configurations: RuntimeConfigurationProvider[] | undefined,
  options: {
    preferredId?: string;
    driver?: RuntimeDriver | WorkflowRuntimeProvider;
    /** Additional filter (e.g. PI vs OMP via command mapping). */
    match?: (configuration: RuntimeConfigurationProvider) => boolean;
  } = {},
): RuntimeConfigurationProvider | undefined => {
  if (!configurations?.length) return undefined;
  const runnable = configurations.filter(
    (item) => item.models.length > 0 && item.driver !== "custom",
  );

  if (options.preferredId) {
    // Exact id wins when it still has models. Callers must only pass preferred ids that
    // are valid for their surface (e.g. control only prefers a session config when drivers match).
    const preferred =
      runnable.find((item) => item.id === options.preferredId) ??
      configurations.find((item) => item.id === options.preferredId && item.models.length > 0);
    if (preferred) return preferred;
  }

  return runnable.find((item) => {
    if (options.driver && item.driver !== options.driver) return false;
    if (options.match && !options.match(item)) return false;
    return true;
  });
};

/** First ordered runnable configuration for a driver (optional preferred id). */
export const findRuntimeConfigurationForDriver = (
  driver: WorkflowRuntimeProvider,
  configurations: RuntimeConfigurationProvider[] | undefined,
  preferredId?: string,
): RuntimeConfigurationProvider | undefined =>
  findRuntimeConfiguration(configurations, { preferredId, driver });

/** Default model + thinking for a provider, preferring runtime configuration when present. */
export const resolveConfiguredProviderDefaults = (
  driver: WorkflowRuntimeProvider,
  configurations?: RuntimeConfigurationProvider[],
  preferredId?: string,
): {
  configuration?: RuntimeConfigurationProvider;
  model: string;
  reasoning: WorkflowRuntimeReasoning;
  supportsFastMode: boolean;
} => {
  const configuration = findRuntimeConfiguration(configurations, { preferredId, driver });
  if (configuration) {
    const model = getDefaultRuntimeConfigurationModel(configuration.models);
    const levels = (model?.thinkingLevels ?? []) as RuntimeThinkingLevel[];
    return {
      configuration,
      model: model?.model ?? "",
      reasoning: resolveRuntimeConfigurationReasoning(
        levels,
        null,
        model?.defaultThinkingLevel ?? null,
      ),
      supportsFastMode: runtimeConfigurationSupportsFastMode(configuration, model?.model ?? ""),
    };
  }
  const model = getDefaultWorkflowRuntimeModel(driver, "");
  return {
    model,
    reasoning: getDefaultWorkflowRuntimeReasoning(driver, model, "medium"),
    supportsFastMode: runtimeSupportsFastMode(driver),
  };
};

/**
 * Resolve a model row inside a configuration, falling back to the default model.
 * Avoids catalog fallbacks when settings are bound but the current model was removed.
 */
export const resolveConfiguredModelRecord = <Model extends { model: string; isDefault: boolean }>(
  configuration: { models: Model[] } | undefined,
  modelId: string | undefined,
): Model | undefined => {
  if (!configuration?.models.length) return undefined;
  if (modelId) {
    const matched = configuration.models.find((item) => item.model === modelId);
    if (matched) return matched;
  }
  return getDefaultRuntimeConfigurationModel(configuration.models);
};
