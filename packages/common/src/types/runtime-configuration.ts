import { z } from "zod";
import { type CliProvider, CliProviderSchema, type ReasoningEffort } from "../projects/runtime.ts";
import {
  CLI_PROVIDER_OPTIONS,
  formatRuntimeModelLabel,
  getRuntimeModelOptions,
  getThinkingOptions,
  SAFE_CUSTOM_RUNTIME_MODEL_PATTERN,
  supportsFastMode,
} from "./runtime-catalog.ts";

export const RuntimeThinkingLevelSchema = z.enum(["low", "medium", "high", "extra-high", "max"]);
export type RuntimeThinkingLevel = z.infer<typeof RuntimeThinkingLevelSchema>;

/** The adapter a configuration's command speaks; the runtime catalog decides which exist. */
const RuntimeDriverSchema = CliProviderSchema;
export type RuntimeDriver = z.infer<typeof RuntimeDriverSchema>;

export const RuntimeConfigurationProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  command: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/-]+$/, "Executable must be a single command token"),
  driver: RuntimeDriverSchema.default("claude-code"),
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
  id: CliProvider;
  driver: CliProvider;
  models: RuntimeConfigurationModelInput[];
}

const RUNTIME_COMMANDS: Record<CliProvider, string> = {
  "claude-code": "claude",
};

/** Default Fast capability for a built-in runtime driver (not per-model). */
export const runtimeSupportsFastMode = (driver: RuntimeDriver): boolean =>
  getRuntimeModelOptions(driver).some((model) => supportsFastMode(driver, model));

export const runtimeConfigurationSupportsFastMode = (
  configuration: Pick<RuntimeConfigurationProvider, "builtIn" | "driver" | "supportsFastMode">,
  model: string,
): boolean => {
  if (!supportsFastMode(configuration.driver, model)) return false;
  return configuration.builtIn || configuration.supportsFastMode;
};

export const BUILT_IN_RUNTIME_CONFIGURATIONS: BuiltInRuntimeConfiguration[] =
  CLI_PROVIDER_OPTIONS.map(({ value: provider, label: name }) => ({
    id: provider,
    name,
    command: RUNTIME_COMMANDS[provider],
    driver: provider,
    supportsFastMode: runtimeSupportsFastMode(provider),
    models: getRuntimeModelOptions(provider).map((model) => ({
      description: formatRuntimeModelLabel(model),
      model,
      thinkingLevels: getThinkingOptions(provider, model).map((option) => option.value),
    })),
  }));

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
  current: ReasoningEffort | null | undefined = null,
  defaultThinkingLevel: RuntimeThinkingLevel | null = null,
): ReasoningEffort =>
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
