import type { StepAgent } from "../protocol/index.ts";

export type WorkflowRuntimeProvider = StepAgent["provider"];
export type WorkflowRuntimeReasoning = StepAgent["reasoning"];

// The static runtime catalog. Phase 1 ships Claude Code only; a runtime is exposed to pickers,
// settings and validation by having an entry here, so adding one is a single-table change.
interface RuntimeCatalogEntry {
  label: string;
  models: readonly string[];
  modelLabels: Readonly<Record<string, string>>;
  /** Models that accept the "max" effort level; every other model tops out at "extra-high". */
  maxThinkingModels: ReadonlySet<string>;
  /** Models with a Fast mode toggle. */
  fastModeModels: ReadonlySet<string>;
  /** Provider-native names for the normalized effort scale. */
  thinkingLabels: Readonly<Record<WorkflowRuntimeReasoning, string>>;
}

const CLAUDE_CODE_MODELS = [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-fable-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

const RUNTIME_CATALOG: Record<WorkflowRuntimeProvider, RuntimeCatalogEntry> = {
  "claude-code": {
    label: "Claude Code",
    models: CLAUDE_CODE_MODELS,
    modelLabels: {
      "claude-opus-5": "Opus 5",
      "claude-opus-4-8": "Opus 4.8",
      "claude-opus-4-7": "Opus 4.7",
      "claude-opus-4-6": "Opus 4.6",
      "claude-fable-5": "Fable 5",
      "claude-sonnet-4-6": "Sonnet 4.6",
      "claude-haiku-4-5": "Haiku 4.5",
    },
    maxThinkingModels: new Set(["claude-opus-5", "claude-opus-4-8", "claude-fable-5"]),
    fastModeModels: new Set(["claude-opus-5"]),
    thinkingLabels: {
      low: "Low",
      medium: "Medium",
      high: "High",
      "extra-high": "Extra",
      max: "Max",
    },
  },
};

export const WORKFLOW_RUNTIME_LABELS: Record<WorkflowRuntimeProvider, string> = {
  "claude-code": RUNTIME_CATALOG["claude-code"].label,
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

export const DEFAULT_RUNTIME_MODEL = "default";
/**
 * Model ids reach the agent CLI as a single argv entry, so this only has to keep
 * out whitespace and shell metacharacters. Brackets are allowed because vendors
 * put context-window variants in them (e.g. a `[1m]` suffix).
 */
export const SAFE_CUSTOM_RUNTIME_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/;

export const isSafeCustomRuntimeModel = (model: string): boolean =>
  model !== DEFAULT_RUNTIME_MODEL && SAFE_CUSTOM_RUNTIME_MODEL_PATTERN.test(model);

export const isWorkflowRuntimeProvider = (value: string): value is WorkflowRuntimeProvider =>
  value in RUNTIME_CATALOG;

export const getWorkflowModelOptions = (provider: WorkflowRuntimeProvider): readonly string[] =>
  RUNTIME_CATALOG[provider].models;

export const isAllowedWorkflowRuntimeModel = (
  provider: WorkflowRuntimeProvider,
  model: string,
): boolean => RUNTIME_CATALOG[provider].models.includes(model);

const MODEL_LABELS: Record<string, string> = Object.assign(
  {},
  ...Object.values(RUNTIME_CATALOG).map((entry) => entry.modelLabels),
);

export const formatWorkflowRuntimeModelLabel = (model: string): string =>
  MODEL_LABELS[model] ?? model;

export const supportsFastMode = (provider: WorkflowRuntimeProvider, model: string): boolean =>
  RUNTIME_CATALOG[provider].fastModeModels.has(model);

export const getWorkflowThinkingLabel = (
  provider: WorkflowRuntimeProvider,
  reasoning: WorkflowRuntimeReasoning,
): string => RUNTIME_CATALOG[provider].thinkingLabels[reasoning];

export const getWorkflowThinkingOptions = (
  provider: WorkflowRuntimeProvider,
  model: string,
): readonly { value: WorkflowRuntimeReasoning; label: string }[] => {
  const acceptsMax = RUNTIME_CATALOG[provider].maxThinkingModels.has(model);
  return WORKFLOW_THINKING_OPTIONS.filter((option) => acceptsMax || option.value !== "max").map(
    (option) => ({ value: option.value, label: getWorkflowThinkingLabel(provider, option.value) }),
  );
};

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

export const getDefaultWorkflowRuntimeModel = (
  provider: WorkflowRuntimeProvider,
  currentModel: string,
): string => {
  const trimmed = currentModel.trim();
  if (trimmed !== DEFAULT_RUNTIME_MODEL && isSafeCustomRuntimeModel(trimmed)) {
    return trimmed;
  }
  return isAllowedWorkflowRuntimeModel(provider, currentModel)
    ? currentModel
    : (getWorkflowModelOptions(provider)[0] ?? currentModel);
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
  const runtimeAlias =
    agent.provider === provider ? normalizeRuntimeAlias(agent.runtimeAlias) : undefined;
  const { runtimeAlias: _runtimeAlias, ...baseAgent } = agent;

  return {
    ...baseAgent,
    provider,
    model,
    reasoning,
    fastMode,
    ultracode: agent.ultracode ?? false,
    ...resolveControlCapabilities(agent),
    ...(runtimeAlias ? { runtimeAlias } : {}),
  };
};

// Claude Code cannot drive the desktop from a detached session, so computer control is always off.
const resolveControlCapabilities = (
  agent: StepAgent,
): Pick<StepAgent, "browserControl" | "computerControl"> | Record<string, never> => {
  if (agent.browserControl === undefined && agent.computerControl === undefined) return {};
  return { browserControl: agent.browserControl ?? false, computerControl: false };
};

const normalizeRuntimeAlias = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
