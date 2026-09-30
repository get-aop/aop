import { z } from "zod";
import { CliProviderSchema } from "../projects/runtime.ts";
import { SAFE_CUSTOM_RUNTIME_MODEL_PATTERN, supportsFastMode } from "./runtime-catalog.ts";

const RuntimeProfileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  baseProvider: CliProviderSchema,
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
});

export const RuntimeProfileInputSchema = RuntimeProfileFieldsSchema.superRefine((profile, ctx) => {
  if (profile.fastMode && !supportsFastMode(profile.baseProvider, profile.model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fastMode"],
      message: "Fast mode is not available for this model",
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
