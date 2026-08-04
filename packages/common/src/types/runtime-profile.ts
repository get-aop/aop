import { z } from "zod";
import type { StepAgent } from "../protocol/index.ts";
import { SAFE_CUSTOM_RUNTIME_MODEL_PATTERN } from "./workflow-runtime.ts";

const RuntimeProfileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  baseProvider: z.enum(["claude-code", "codex-cli", "grok-build", "opencode", "pi"]),
  command: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/-]+$/, "Command must be a single executable name or path"),
  model: z
    .string()
    .trim()
    .regex(SAFE_CUSTOM_RUNTIME_MODEL_PATTERN, "Model must be a valid provider model identifier"),
  reasoning: z.enum(["low", "medium", "high", "extra-high", "max"]),
  fastMode: z.boolean(),
  /**
   * When set, agent CLI and verification run on this SSH execution host.
   * Empty string clears a previously bound host (PATCH).
   */
  execHostId: z.string().trim().optional(),
});

export const RuntimeProfileInputSchema = RuntimeProfileFieldsSchema.superRefine((profile, ctx) => {
  if (profile.fastMode && profile.baseProvider !== "codex-cli") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fastMode"],
      message: "Fast mode is only available for Codex CLI",
    });
  }
});

export const RuntimeProfilePatchSchema = RuntimeProfileFieldsSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  "At least one profile field is required",
);

export type RuntimeProfileInput = z.infer<typeof RuntimeProfileInputSchema>;
export type RuntimeProfilePatch = z.infer<typeof RuntimeProfilePatchSchema>;

export interface RuntimeProfile extends RuntimeProfileInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const applyRuntimeProfile = (profile: RuntimeProfile): StepAgent => ({
  provider: profile.baseProvider,
  model: profile.model,
  reasoning: profile.reasoning,
  fastMode: profile.fastMode,
  ultracode: false,
  runtimeAlias: profile.command,
  ...(profile.execHostId && profile.execHostId.length > 0
    ? { execHostId: profile.execHostId }
    : {}),
});
