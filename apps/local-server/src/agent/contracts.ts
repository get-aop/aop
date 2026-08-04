import { z } from "zod";

export const AGENT_LIMIT = 3;
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const HERMES_PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const AgentRoleSchema = z.enum(["architect", "developer", "reviewer", "custom"]);
export const AgentRuntimeProviderSchema = z.enum([
  "hermes",
  "pi",
  "codex-cli",
  "grok-build",
  "opencode",
]);
export const AgentModelProviderSchema = z.enum([
  "openai-codex",
  "anthropic",
  "pi",
  "codex-cli",
  "grok-build",
  "opencode",
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type AgentRuntimeProvider = z.infer<typeof AgentRuntimeProviderSchema>;
export type AgentModelProvider = z.infer<typeof AgentModelProviderSchema>;

export const AgentNameSchema = z
  .string()
  .trim()
  .min(1, "Agent name is required")
  .max(64, "Agent name must be 64 characters or fewer")
  .regex(
    AGENT_NAME_RE,
    "Agent name may contain letters, numbers, spaces, hyphens, and underscores",
  );

export const HermesProfileNameSchema = z
  .string()
  .trim()
  .min(1, "Hermes profile is required")
  .refine((value) => value === "default" || HERMES_PROFILE_RE.test(value), {
    message:
      "Hermes profile must be 'default' or use lowercase letters, numbers, hyphens, and underscores",
  });

export const WorkflowIdSchema = z.string().trim().min(1, "Workflow is required");
export const ModelSchema = z
  .string()
  .trim()
  .min(1, "Model is required")
  .max(120, "Model must be 120 characters or fewer");
export const OptionalContentSchema = z
  .string()
  .trim()
  .min(1, "Content must not be empty")
  .max(50_000, "Content must be 50,000 characters or fewer");

export const ManualAgentInputSchema = z
  .object({
    name: AgentNameSchema,
    role: AgentRoleSchema,
    workflowId: WorkflowIdSchema,
    runtimeProvider: z.literal("hermes"),
    provider: z.enum(["openai-codex", "anthropic"]),
    model: ModelSchema,
    autoDistributeDisabled: z.boolean().optional(),
    soul: OptionalContentSchema.optional(),
    memory: OptionalContentSchema.optional(),
  })
  .superRefine((input, ctx) => {
    validateProviderModel(input.provider, input.model, ctx);
  });

export const FocusSchema = z.string().trim().max(200, "Focus must be 200 characters or fewer");

export const WorkerProfileInputSchema = z
  .object({
    name: AgentNameSchema,
    role: z.literal("developer").default("developer"),
    workflowId: WorkflowIdSchema,
    repoIds: z.array(z.string().min(1)).min(1, "Select at least one repository"),
    autoDistributeDisabled: z.boolean().optional(),
    focus: FocusSchema.optional(),
  })
  .passthrough();

export const HermesAgentImportInputSchema = z.object({
  profileName: HermesProfileNameSchema,
  role: AgentRoleSchema,
  workflowId: WorkflowIdSchema,
  name: AgentNameSchema.optional(),
});

export interface AgentDto {
  id: string;
  name: string;
  role: AgentRole;
  runtimeProvider: AgentRuntimeProvider;
  provider: AgentModelProvider;
  model: string;
  workflowId: string;
  workflowName: string;
  focus: string | null;
  status: "active" | "archived";
  artifactPath: string;
  sourceKind:
    | "manual"
    | "hermes-profile"
    | "pi-worker-profile"
    | "codex-cli-worker-profile"
    | "grok-build-worker-profile"
    | "opencode-worker-profile";
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HermesProfileSummary {
  name: string;
  sourcePath: string;
  provider: string;
  model: string;
  cwd: string | null;
  reasoningEffort: string | null;
  isSupported: boolean;
  validationError: string | null;
}

export const validateProviderModel = (
  provider: string,
  model: string,
  ctx?: z.RefinementCtx,
): string | null => {
  if (provider !== "openai-codex" && provider !== "anthropic") {
    const message = `Hermes provider '${provider}' is not supported in AOP v1`;
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["provider"], message });
    return message;
  }

  if (provider === "anthropic" && !model.startsWith("claude")) {
    const message = "Anthropic Hermes profiles must use a claude* model";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message });
    return message;
  }

  if (provider === "openai-codex" && model.startsWith("claude")) {
    const message = "openai-codex Hermes profiles cannot use a claude* model";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message });
    return message;
  }

  return null;
};
