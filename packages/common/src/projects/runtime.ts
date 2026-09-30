import { z } from "zod";
import { SAFE_CUSTOM_RUNTIME_MODEL_PATTERN } from "../types/runtime-catalog.ts";

/**
 * The agent CLIs a Project can drive: the runtime catalog. Phase 1 is Claude Code only; the id
 * matches the adapter id the runtime layer uses, so a value here can be handed to an adapter
 * unchanged. The Codex and PI adapters exist but stay out of this list until Phase 2.
 */
export const CliProviderSchema = z.enum(["claude-code"]);
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

/**
 * What one role (the coordinator, or a thread) runs on: a provider plus an optional model and
 * effort. A null model or effort is "use default": AOP passes no `--model` or `--effort` to the
 * CLI and the CLI decides, so a changed default follows and a plan without a catalog model
 * still runs. A project setting stores it, and a thread records the one it started with.
 */
export const RuntimePreferenceSchema = z.object({
  provider: CliProviderSchema,
  model: ModelSchema.nullable(),
  effort: ReasoningEffortSchema.nullable(),
});
export type RuntimePreference = z.infer<typeof RuntimePreferenceSchema>;
