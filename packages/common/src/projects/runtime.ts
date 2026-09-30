import { z } from "zod";
import { SAFE_CUSTOM_RUNTIME_MODEL_PATTERN } from "../types/workflow-runtime.ts";

/**
 * The agent CLIs a Project can drive. Exactly these three; the ids match the adapter ids the
 * runtime layer already uses, so a value here can be handed to an adapter unchanged.
 */
export const CliProviderSchema = z.enum(["claude-code", "codex-cli", "pi"]);
export type CliProvider = z.infer<typeof CliProviderSchema>;

/** Normalized effort scale; each adapter maps it onto its own CLI's flag. */
export const ReasoningEffortSchema = z.enum(["low", "medium", "high", "extra-high", "max"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/**
 * Model ids reach a CLI argv, so the pattern rejects anything that could read as a flag or
 * contain whitespace. Whether the model belongs to the provider is checked by the runtime catalog.
 */
export const ModelSchema = z.string().regex(SAFE_CUSTOM_RUNTIME_MODEL_PATTERN, {
  error: "Model must be a valid provider model identifier",
});

/** What a run actually uses. Recorded on a thread: the chip in its composer shows these values. */
export const RuntimeSelectionSchema = z.object({
  provider: CliProviderSchema,
  model: ModelSchema,
  effort: ReasoningEffortSchema,
});
export type RuntimeSelection = z.infer<typeof RuntimeSelectionSchema>;

/**
 * What a project setting stores for one role (coordinator or thread). A null model or effort
 * means "use the provider's default", resolved when a run starts, so a changed default follows.
 */
export const RuntimePreferenceSchema = z.object({
  provider: CliProviderSchema,
  model: ModelSchema.nullable(),
  effort: ReasoningEffortSchema.nullable(),
});
export type RuntimePreference = z.infer<typeof RuntimePreferenceSchema>;
