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
 * The runtime configuration a role runs on when nothing else is chosen: the built-in Claude Code
 * one (seeded with this id). Projects stored before runtimes could be picked run on it.
 */
export const BUILT_IN_RUNTIME_ID = "claude-code";

/** A runtime configuration id (AOP settings › Runtimes): the built-in one or a custom command. */
export const RuntimeIdSchema = z.string().min(1).max(200);

/**
 * What one role (the coordinator, or a thread) runs on: a runtime configuration (the command
 * that is launched and the models it offers), its provider (the adapter that command speaks,
 * always the configuration's driver), and an optional model and effort. A null model or effort
 * is "use default": AOP passes no `--model` or `--effort` to the CLI and the CLI decides, so a
 * changed default follows and a plan without a catalog model still runs. A project setting
 * stores it, and a thread records the one it started with.
 */
export const RuntimePreferenceSchema = z.object({
  provider: CliProviderSchema,
  runtimeId: RuntimeIdSchema,
  model: ModelSchema.nullable(),
  effort: ReasoningEffortSchema.nullable(),
});
export type RuntimePreference = z.infer<typeof RuntimePreferenceSchema>;

/**
 * A role as a client sends it. Without `runtimeId` the host decides: a new project takes the
 * host's default runtime, and a change keeps the runtime the project already has, so a client
 * written before runtimes could be picked (or a tool that only sets the model) changes nothing
 * it does not name.
 */
export const RuntimePreferenceInputSchema = RuntimePreferenceSchema.extend({
  runtimeId: RuntimeIdSchema.optional(),
});
export type RuntimePreferenceInput = z.infer<typeof RuntimePreferenceInputSchema>;
