import { z } from "zod";
import type { StepAgent } from "../protocol/index.ts";

export type WorkflowRuntimeProvider = StepAgent["provider"];
export type WorkflowRuntimeReasoning = StepAgent["reasoning"];

export const WORKFLOW_RUNTIME_LABELS: Record<WorkflowRuntimeProvider, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex CLI",
  "grok-build": "Grok",
  opencode: "OpenCode",
  pi: "PI",
};

export const WORKFLOW_RUNTIME_OPTIONS = (
  Object.entries(WORKFLOW_RUNTIME_LABELS) as [WorkflowRuntimeProvider, string][]
).map(([value, label]) => ({ value, label }));

export const WORKFLOW_THINKING_OPTIONS: {
  value: WorkflowRuntimeReasoning;
  label: string;
}[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "extra-high", label: "Extra-High" },
  { value: "max", label: "Max" },
];

const CLAUDE_CODE_THINKING_LABELS: Record<WorkflowRuntimeReasoning, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  "extra-high": "Extra",
  max: "Max",
};

const CODEX_THINKING_LABELS: Record<WorkflowRuntimeReasoning, string> = {
  low: "Light",
  medium: "Medium",
  high: "High",
  "extra-high": "Extra-High",
  max: "Ultra",
};

export const CLAUDE_CODE_MODEL_OPTIONS = [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-fable-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;
export const CODEX_CLI_MODEL_OPTIONS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;
export const GROK_BUILD_MODEL_OPTIONS = ["grok-4.5", "grok-composer-2.5-fast"] as const;
export const OPENCODE_MODEL_OPTIONS = [
  "opencode-go/kimi-k2.7-code",
  "opencode-go/glm-5.2",
  "zai-coding-plan/glm-5.2",
  "openai/gpt-5.5",
  "openai/gpt-5.5-fast",
  "openai/gpt-5.6",
  "openai/gpt-5.6-fast",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-fast",
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-pro",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-fast",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-fast",
  "openai/gpt-5.6-terra-pro",
] as const;

export const OPENCODE_THINKING_MODEL_OPTIONS = OPENCODE_MODEL_OPTIONS.filter((model) =>
  model.startsWith("openai/gpt-"),
);
const OPENCODE_GLM_5_2_THINKING_MODEL_OPTIONS = new Set<string>([
  "opencode-go/glm-5.2",
  "zai-coding-plan/glm-5.2",
]);
export const PI_MODEL_OPTIONS = [
  "openai-codex/gpt-5.5",
  "openai-codex/gpt-5.6-luna",
  "openai-codex/gpt-5.6-sol",
  "openai-codex/gpt-5.6-terra",
  "kimi-coding/k3",
  "deepseek-v4-flash",
] as const;
// Kimi K3 only accepts max thinking; pi clamps any other requested level to max.
const PI_MAX_THINKING_ONLY_MODEL_OPTIONS = new Set<string>(["kimi-coding/k3"]);
// DeepSeek V4 Flash exposes only high and max thinking.
const PI_HIGH_MAX_THINKING_MODEL_OPTIONS = new Set<string>(["deepseek-v4-flash"]);
const CLAUDE_MAX_THINKING_MODEL_OPTIONS = new Set<string>([
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-fable-5",
]);
const GROK_THINKING_MODEL_OPTIONS = new Set<string>(["grok-4.5"]);

export const DEFAULT_RUNTIME_MODEL = "default";
/**
 * Model ids reach the agent CLI as a single argv entry, so this only has to keep
 * out whitespace and shell metacharacters. Brackets are allowed because vendors
 * put context-window variants in them (e.g. Kimi's `k3[1m]`).
 */
export const SAFE_CUSTOM_RUNTIME_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/;

export const WORKFLOW_MODEL_LABELS: Record<string, string> = {
  "claude-opus-5": "Opus 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-6": "Opus 4.6",
  "claude-fable-5": "Fable 5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
  "openai-codex/gpt-5.5": "GPT 5.5",
  "openai-codex/gpt-5.6-luna": "GPT 5.6 Luna",
  "openai-codex/gpt-5.6-sol": "GPT 5.6 Sol",
  "openai-codex/gpt-5.6-terra": "GPT 5.6 Terra",
  "kimi-coding/k3": "Kimi K3 Max",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "gpt-5.5": "GPT 5.5",
  "openai/gpt-5.5": "GPT 5.5",
  "openai/gpt-5.5-fast": "GPT 5.5 Fast",
  "gpt-5.6-sol": "GPT 5.6 Sol",
  "gpt-5.6-terra": "GPT 5.6 Terra",
  "gpt-5.6-luna": "GPT 5.6 Luna",
  "openai/gpt-5.6": "GPT 5.6",
  "openai/gpt-5.6-fast": "GPT 5.6 Fast",
  "openai/gpt-5.6-luna": "GPT 5.6 Luna",
  "openai/gpt-5.6-luna-fast": "GPT 5.6 Luna Fast",
  "openai/gpt-5.6-luna-pro": "GPT 5.6 Luna Pro",
  "openai/gpt-5.6-pro": "GPT 5.6 Pro",
  "openai/gpt-5.6-sol": "GPT 5.6 Sol",
  "openai/gpt-5.6-sol-fast": "GPT 5.6 Sol Fast",
  "openai/gpt-5.6-sol-pro": "GPT 5.6 Sol Pro",
  "openai/gpt-5.6-terra": "GPT 5.6 Terra",
  "openai/gpt-5.6-terra-fast": "GPT 5.6 Terra Fast",
  "openai/gpt-5.6-terra-pro": "GPT 5.6 Terra Pro",
  "grok-4.5": "Grok 4.5",
  "grok-composer-2.5-fast": "Composer 2.5 Fast",
  "opencode-go/kimi-k2.7-code": "Kimi K2.7 Code",
  "opencode-go/glm-5.2": "GLM 5.2 (OpenCode Go)",
  "zai-coding-plan/glm-5.2": "GLM 5.2 (Z.AI Coding Plan)",
};

export const WORKFLOW_MODEL_OPTIONS: Record<
  "claude-code" | "codex-cli" | "grok-build" | "opencode" | "pi",
  readonly string[]
> = {
  "claude-code": CLAUDE_CODE_MODEL_OPTIONS,
  "codex-cli": CODEX_CLI_MODEL_OPTIONS,
  "grok-build": GROK_BUILD_MODEL_OPTIONS,
  opencode: OPENCODE_MODEL_OPTIONS,
  pi: PI_MODEL_OPTIONS,
};

export const isComposerOrKimiModel = (model: string): boolean => {
  const normalized = model.toLowerCase();
  return normalized.includes("composer") || normalized.includes("kimi");
};

export const isSafeCustomRuntimeModel = (model: string): boolean =>
  model !== DEFAULT_RUNTIME_MODEL && SAFE_CUSTOM_RUNTIME_MODEL_PATTERN.test(model);

export const supportsOpenCodeThinking = (model: string): boolean => {
  const trimmed = model.trim();
  if (trimmed.length === 0) return false;

  const baseModel = trimmed.split("/").slice(0, -1).join("/") || trimmed;
  if (
    OPENCODE_GLM_5_2_THINKING_MODEL_OPTIONS.has(trimmed) ||
    OPENCODE_GLM_5_2_THINKING_MODEL_OPTIONS.has(baseModel)
  ) {
    return true;
  }

  return OPENCODE_THINKING_MODEL_OPTIONS.some(
    (allowedModel) => allowedModel === trimmed || allowedModel === baseModel,
  );
};

export const supportsThinkingLevel = (
  provider: WorkflowRuntimeProvider,
  model: string,
): boolean => {
  if (provider === "pi" && PI_MAX_THINKING_ONLY_MODEL_OPTIONS.has(model)) {
    return true;
  }

  if (isComposerOrKimiModel(model)) {
    return false;
  }

  if (provider === "claude-code" || provider === "codex-cli" || provider === "pi") {
    return true;
  }

  if (provider === "grok-build") {
    return GROK_THINKING_MODEL_OPTIONS.has(model);
  }

  if (provider === "opencode") {
    return supportsOpenCodeThinking(model);
  }

  return false;
};

export const supportsMaxThinkingLevel = (
  provider: WorkflowRuntimeProvider,
  model: string,
): boolean =>
  (provider === "claude-code" && CLAUDE_MAX_THINKING_MODEL_OPTIONS.has(model)) ||
  provider === "codex-cli" ||
  provider === "pi" ||
  (provider === "opencode" &&
    (OPENCODE_GLM_5_2_THINKING_MODEL_OPTIONS.has(model) || supportsOpenCodeThinking(model)));

export const supportsUltracode = (provider: WorkflowRuntimeProvider, model: string): boolean =>
  provider === "claude-code" && supportsThinkingLevel(provider, model);

export const getWorkflowThinkingOptions = (
  provider: WorkflowRuntimeProvider,
  model: string,
): readonly { value: WorkflowRuntimeReasoning; label: string }[] => {
  if (provider === "pi" && PI_MAX_THINKING_ONLY_MODEL_OPTIONS.has(model)) {
    return WORKFLOW_THINKING_OPTIONS.filter((option) => option.value === "max");
  }

  if (provider === "pi" && PI_HIGH_MAX_THINKING_MODEL_OPTIONS.has(model)) {
    return WORKFLOW_THINKING_OPTIONS.filter(
      (option) => option.value === "high" || option.value === "max",
    ).map((option) => ({
      ...option,
      label: getWorkflowThinkingLabel(provider, option.value, model),
    }));
  }

  if (provider === "opencode" && OPENCODE_GLM_5_2_THINKING_MODEL_OPTIONS.has(model)) {
    return WORKFLOW_THINKING_OPTIONS.filter(
      (option) => option.value === "high" || option.value === "max",
    ).map((option) => ({
      ...option,
      label: getWorkflowThinkingLabel(provider, option.value, model),
    }));
  }

  if (provider === "grok-build" && GROK_THINKING_MODEL_OPTIONS.has(model)) {
    return WORKFLOW_THINKING_OPTIONS.filter(
      (option) => option.value === "low" || option.value === "medium" || option.value === "high",
    ).map((option) => ({
      ...option,
      label: getWorkflowThinkingLabel(provider, option.value, model),
    }));
  }

  if (supportsMaxThinkingLevel(provider, model)) {
    return WORKFLOW_THINKING_OPTIONS.map((option) => ({
      ...option,
      label: getWorkflowThinkingLabel(provider, option.value, model),
    }));
  }

  return WORKFLOW_THINKING_OPTIONS.filter((option) => option.value !== "max").map((option) => ({
    ...option,
    label: getWorkflowThinkingLabel(provider, option.value, model),
  }));
};

export const getWorkflowThinkingLabel = (
  provider: WorkflowRuntimeProvider,
  reasoning: WorkflowRuntimeReasoning,
  model = "",
): string => {
  if (provider === "claude-code") return CLAUDE_CODE_THINKING_LABELS[reasoning];
  if (
    provider === "codex-cli" ||
    provider === "pi" ||
    (provider === "opencode" && model.startsWith("openai/"))
  ) {
    return CODEX_THINKING_LABELS[reasoning];
  }
  return WORKFLOW_THINKING_OPTIONS.find((option) => option.value === reasoning)?.label ?? reasoning;
};

export const isAllowedWorkflowRuntimeReasoning = (
  provider: WorkflowRuntimeProvider,
  model: string,
  reasoning: WorkflowRuntimeReasoning,
): boolean =>
  getWorkflowThinkingOptions(provider, model).some((option) => option.value === reasoning);

export const getDefaultWorkflowRuntimeReasoning = (
  provider: WorkflowRuntimeProvider,
  model: string,
  currentReasoning: WorkflowRuntimeReasoning,
): WorkflowRuntimeReasoning => {
  if (!isAllowedWorkflowRuntimeModel(provider, model) && isSafeCustomRuntimeModel(model)) {
    return currentReasoning;
  }
  const options = getWorkflowThinkingOptions(provider, model);
  if (options.some((option) => option.value === currentReasoning)) {
    return currentReasoning;
  }

  return (
    options.find((option) => option.value === "extra-high")?.value ?? options[0]?.value ?? "medium"
  );
};

export const supportsFastMode = (provider: WorkflowRuntimeProvider, model: string): boolean => {
  if (isComposerOrKimiModel(model)) {
    return false;
  }

  if (provider === "codex-cli") {
    return true;
  }

  if (provider === "claude-code" && model === "claude-opus-5") {
    return true;
  }

  // PI uses Codex models with a /fast control command rather than CLI flags.
  if (provider === "pi" && model.startsWith("openai-codex/")) {
    return true;
  }

  return false;
};

const agentSupportsFastMode = (provider: WorkflowRuntimeProvider, model: string): boolean =>
  supportsFastMode(provider, model);

export const supportsRuntimeAlias = (provider: WorkflowRuntimeProvider): boolean =>
  provider in WORKFLOW_RUNTIME_LABELS;

export const supportsThinkingAndFastMode = (
  provider: WorkflowRuntimeProvider,
  model: string,
): boolean => supportsThinkingLevel(provider, model) && supportsFastMode(provider, model);

export const formatWorkflowRuntimeModelLabel = (model: string): string =>
  WORKFLOW_MODEL_LABELS[model] ?? model;

export const getWorkflowModelOptions = (provider: WorkflowRuntimeProvider): readonly string[] =>
  WORKFLOW_MODEL_OPTIONS[provider as keyof typeof WORKFLOW_MODEL_OPTIONS] ?? [];

export const hasWorkflowModelPicker = (provider: WorkflowRuntimeProvider): boolean =>
  provider in WORKFLOW_MODEL_OPTIONS;

export const DEFAULT_WORKFLOW_STEP_AGENT: StepAgent = {
  provider: "codex-cli",
  model: CODEX_CLI_MODEL_OPTIONS[0],
  reasoning: "medium",
  fastMode: false,
  ultracode: false,
};

export const isAllowedWorkflowRuntimeModel = (
  provider: WorkflowRuntimeProvider,
  model: string,
): boolean => {
  if (provider === "claude-code") {
    return CLAUDE_CODE_MODEL_OPTIONS.some((allowedModel) => allowedModel === model);
  }

  if (provider === "grok-build") {
    return GROK_BUILD_MODEL_OPTIONS.some((allowedModel) => allowedModel === model);
  }

  if (provider === "pi") {
    return PI_MODEL_OPTIONS.some((allowedModel) => allowedModel === model);
  }

  if (provider === "opencode") {
    const trimmed = model.trim();
    if (trimmed.length === 0) return false;
    const baseModel = trimmed.split("/").slice(0, -1).join("/") || trimmed;
    return (
      OPENCODE_MODEL_OPTIONS.some((allowedModel) => allowedModel === trimmed) ||
      OPENCODE_MODEL_OPTIONS.some((allowedModel) => allowedModel === baseModel)
    );
  }

  return CODEX_CLI_MODEL_OPTIONS.some((allowedModel) => allowedModel === model);
};

export const getDefaultWorkflowRuntimeModel = (
  provider: WorkflowRuntimeProvider,
  currentModel: string,
): string => {
  const trimmed = currentModel.trim();
  if (trimmed !== DEFAULT_RUNTIME_MODEL && isSafeCustomRuntimeModel(trimmed)) {
    return trimmed;
  }
  if (hasWorkflowModelPicker(provider)) {
    const options = getWorkflowModelOptions(provider);
    return isAllowedWorkflowRuntimeModel(provider, currentModel)
      ? currentModel
      : (options[0] ?? currentModel);
  }

  return currentModel.trim() || DEFAULT_RUNTIME_MODEL;
};

export const applyWorkflowRuntimeProviderDefaults = (
  agent: StepAgent,
  provider: WorkflowRuntimeProvider,
): StepAgent => {
  const model = getDefaultWorkflowRuntimeModel(
    provider,
    agent.provider === provider ? agent.model : "",
  );
  const reasoning = getDefaultWorkflowRuntimeReasoning(provider, model, agent.reasoning);
  const fastMode = supportsFastMode(provider, model) ? (agent.fastMode ?? false) : false;
  const ultracode = supportsUltracode(provider, model) ? (agent.ultracode ?? false) : false;
  const controlCapabilities = resolveControlCapabilities(agent, provider);
  const runtimeAlias =
    agent.provider === provider ? normalizeRuntimeAlias(agent.runtimeAlias) : undefined;
  const { runtimeAlias: _runtimeAlias, ...baseAgent } = agent;

  return {
    ...baseAgent,
    provider,
    model,
    reasoning,
    fastMode,
    ultracode,
    ...controlCapabilities,
    ...(runtimeAlias ? { runtimeAlias } : {}),
  };
};

const resolveControlCapabilities = (
  agent: StepAgent,
  provider: WorkflowRuntimeProvider,
): Pick<StepAgent, "browserControl" | "computerControl"> | Record<string, never> => {
  if (agent.browserControl === undefined && agent.computerControl === undefined) return {};
  return {
    browserControl:
      provider === "claude-code" || provider === "codex-cli"
        ? (agent.browserControl ?? false)
        : false,
    computerControl: provider === "codex-cli" ? (agent.computerControl ?? false) : false,
  };
};

export const applyWorkflowRuntimeModelChange = (agent: StepAgent, model: string): StepAgent => ({
  ...agent,
  model,
  reasoning: getDefaultWorkflowRuntimeReasoning(agent.provider, model, agent.reasoning),
  ultracode: supportsUltracode(agent.provider, model) ? (agent.ultracode ?? false) : false,
  fastMode: supportsFastMode(agent.provider, model) ? (agent.fastMode ?? false) : false,
});

export const normalizeRuntimeModelForRun = (
  provider: WorkflowRuntimeProvider,
  model: string,
): string | undefined => {
  const trimmed = model.trim();
  if (!trimmed || trimmed === DEFAULT_RUNTIME_MODEL) {
    return undefined;
  }

  if (
    provider === "claude-code" ||
    provider === "codex-cli" ||
    provider === "grok-build" ||
    provider === "pi"
  ) {
    return trimmed;
  }

  return trimmed;
};

export const normalizeRuntimeAlias = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const mapRuntimeReasoningEffort = (reasoning: WorkflowRuntimeReasoning): string => {
  if (reasoning !== "extra-high") {
    return reasoning;
  }

  return "xhigh";
};

export const validateWorkflowRuntimeAgent = (
  agent: StepAgent,
  ctx?: z.RefinementCtx,
): string | undefined => {
  const catalogModel = isAllowedWorkflowRuntimeModel(agent.provider, agent.model);
  if (!catalogModel && !isSafeCustomRuntimeModel(agent.model)) {
    const message = `Model "${agent.model}" is not a valid model identifier`;
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message });
    return message;
  }

  if (
    catalogModel &&
    !isAllowedWorkflowRuntimeReasoning(agent.provider, agent.model, agent.reasoning)
  ) {
    const message = `Thinking "${agent.reasoning}" is not available for provider "${agent.provider}" and model "${agent.model}"`;
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["reasoning"], message });
    return message;
  }

  if (agent.fastMode && !agentSupportsFastMode(agent.provider, agent.model)) {
    const message = "Fast mode is only available for Claude Opus 5, Codex CLI, and PI Codex models";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["fastMode"], message });
    return message;
  }

  if (agent.ultracode && !supportsUltracode(agent.provider, agent.model)) {
    const message = "Ultracode is only available for Claude Code workflow steps";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["ultracode"], message });
    return message;
  }

  if (agent.runtimeAlias && normalizeRuntimeAlias(agent.runtimeAlias) !== agent.runtimeAlias) {
    const message = "Runtime alias must not include surrounding whitespace";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["runtimeAlias"], message });
    return message;
  }

  return validateControlCapabilities(agent, ctx);
};

const validateControlCapabilities = (
  agent: StepAgent,
  ctx?: z.RefinementCtx,
): string | undefined => {
  if (agent.browserControl && agent.provider !== "claude-code" && agent.provider !== "codex-cli") {
    const message =
      "Browser control is only available for Claude Code and Codex CLI workflow steps";
    ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["browserControl"], message });
    return message;
  }
  if (!agent.computerControl || agent.provider === "codex-cli") return undefined;
  const message = "Computer control is only available for Codex CLI workflow steps";
  ctx?.addIssue({ code: z.ZodIssueCode.custom, path: ["computerControl"], message });
  return message;
};

export const resolveRuntimeAgent = (agent?: StepAgent): StepAgent => {
  if (!agent) {
    return DEFAULT_WORKFLOW_STEP_AGENT;
  }

  return applyWorkflowRuntimeProviderDefaults(agent, agent.provider);
};

export const isWorkflowRuntimeProvider = (value: string): value is WorkflowRuntimeProvider =>
  value in WORKFLOW_RUNTIME_LABELS;

const WORKFLOW_RUNTIME_REASONING_VALUES = WORKFLOW_THINKING_OPTIONS.map((option) => option.value);

export const parseRuntimeAgentSettings = (
  providerValue?: string,
  modelValue?: string,
  reasoningValue?: string,
  ultracodeValue?: string,
  runtimeAliasValue?: string,
  fastModeValue?: string,
): StepAgent => {
  const provider = providerValue?.trim() ?? "";
  if (!isWorkflowRuntimeProvider(provider)) {
    return DEFAULT_WORKFLOW_STEP_AGENT;
  }

  const reasoning = WORKFLOW_RUNTIME_REASONING_VALUES.includes(
    reasoningValue as WorkflowRuntimeReasoning,
  )
    ? (reasoningValue as WorkflowRuntimeReasoning)
    : DEFAULT_WORKFLOW_STEP_AGENT.reasoning;

  const agent = resolveRuntimeAgent({
    provider,
    model: modelValue?.trim() ?? "",
    reasoning,
    fastMode: supportsFastMode(provider, modelValue?.trim() ?? "") && fastModeValue === "true",
    ultracode: ultracodeValue === "true",
    ...(normalizeRuntimeAlias(runtimeAliasValue)
      ? { runtimeAlias: normalizeRuntimeAlias(runtimeAliasValue) }
      : {}),
  });

  if (
    !isAllowedWorkflowRuntimeModel(agent.provider, agent.model) &&
    !isSafeCustomRuntimeModel(agent.model)
  ) {
    return applyWorkflowRuntimeProviderDefaults(
      { ...DEFAULT_WORKFLOW_STEP_AGENT, provider, reasoning },
      provider,
    );
  }

  return agent;
};
