import type { CliProvider, ReasoningEffort } from "../projects/runtime.ts";

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
  thinkingLabels: Readonly<Record<ReasoningEffort, string>>;
}

// Newest first within a family. The first entry is the fallback when a stored model is unusable, and
// the CLI's own aliases resolve to claude-opus-5-5, claude-sonnet-5-5, claude-haiku-4-5 and
// claude-fable-5-1 (Claude Code 2.1.285). Older ids stay listed so a project that names one keeps
// working and keeps showing it in pickers.
const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-sonnet-5-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

const RUNTIME_CATALOG: Record<CliProvider, RuntimeCatalogEntry> = {
  "claude-code": {
    label: "Claude Code",
    models: CLAUDE_CODE_MODELS,
    modelLabels: {
      "claude-opus-5-5": "Opus 5.5",
      "claude-opus-5": "Opus 5",
      "claude-opus-4-8": "Opus 4.8",
      "claude-opus-4-7": "Opus 4.7",
      "claude-opus-4-6": "Opus 4.6",
      "claude-fable-5-1": "Fable 5.1",
      "claude-fable-5": "Fable 5",
      "claude-sonnet-5-5": "Sonnet 5.5",
      "claude-sonnet-4-6": "Sonnet 4.6",
      "claude-haiku-4-5": "Haiku 4.5",
    },
    maxThinkingModels: new Set([
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-sonnet-5-5",
    ]),
    fastModeModels: new Set(["claude-opus-5-5", "claude-opus-5"]),
    thinkingLabels: {
      low: "Low",
      medium: "Medium",
      high: "High",
      "extra-high": "Extra",
      max: "Max",
    },
  },
};

export const CLI_PROVIDER_LABELS: Record<CliProvider, string> = {
  "claude-code": RUNTIME_CATALOG["claude-code"].label,
};

export const CLI_PROVIDER_OPTIONS = (
  Object.entries(CLI_PROVIDER_LABELS) as [CliProvider, string][]
).map(([value, label]) => ({ value, label }));

export const THINKING_OPTIONS: {
  value: ReasoningEffort;
  label: string;
}[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "extra-high", label: "Extra-High" },
  { value: "max", label: "Max" },
];

const DEFAULT_RUNTIME_MODEL = "default";
/**
 * Model ids reach the agent CLI as a single argv entry, so this only has to keep
 * out whitespace and shell metacharacters. Brackets are allowed because vendors
 * put context-window variants in them (e.g. a `[1m]` suffix).
 */
export const SAFE_CUSTOM_RUNTIME_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/;

export const isSafeCustomRuntimeModel = (model: string): boolean =>
  model !== DEFAULT_RUNTIME_MODEL && SAFE_CUSTOM_RUNTIME_MODEL_PATTERN.test(model);

export const isCliProvider = (value: string): value is CliProvider => value in RUNTIME_CATALOG;

export const getRuntimeModelOptions = (provider: CliProvider): readonly string[] =>
  RUNTIME_CATALOG[provider].models;

export const isAllowedRuntimeModel = (provider: CliProvider, model: string): boolean =>
  RUNTIME_CATALOG[provider].models.includes(model);

const MODEL_LABELS: Record<string, string> = Object.assign(
  {},
  ...Object.values(RUNTIME_CATALOG).map((entry) => entry.modelLabels),
);

export const formatRuntimeModelLabel = (model: string): string => MODEL_LABELS[model] ?? model;

export const supportsFastMode = (provider: CliProvider, model: string): boolean =>
  RUNTIME_CATALOG[provider].fastModeModels.has(model);

export const getThinkingLabel = (provider: CliProvider, reasoning: ReasoningEffort): string =>
  RUNTIME_CATALOG[provider].thinkingLabels[reasoning];

export const getThinkingOptions = (
  provider: CliProvider,
  model: string,
): readonly { value: ReasoningEffort; label: string }[] => {
  const acceptsMax = RUNTIME_CATALOG[provider].maxThinkingModels.has(model);
  return THINKING_OPTIONS.filter((option) => acceptsMax || option.value !== "max").map(
    (option) => ({ value: option.value, label: getThinkingLabel(provider, option.value) }),
  );
};

export const getDefaultRuntimeReasoning = (
  provider: CliProvider,
  model: string,
  currentReasoning: ReasoningEffort,
): ReasoningEffort => {
  if (!isAllowedRuntimeModel(provider, model) && isSafeCustomRuntimeModel(model)) {
    return currentReasoning;
  }
  const options = getThinkingOptions(provider, model);
  if (options.some((option) => option.value === currentReasoning)) {
    return currentReasoning;
  }

  return (
    options.find((option) => option.value === "extra-high")?.value ?? options[0]?.value ?? "medium"
  );
};

export const getDefaultRuntimeModel = (provider: CliProvider, currentModel: string): string => {
  const trimmed = currentModel.trim();
  if (trimmed !== DEFAULT_RUNTIME_MODEL && isSafeCustomRuntimeModel(trimmed)) {
    return trimmed;
  }
  return isAllowedRuntimeModel(provider, currentModel)
    ? currentModel
    : (getRuntimeModelOptions(provider)[0] ?? currentModel);
};
