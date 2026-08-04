import {
  findRuntimeConfiguration,
  getDefaultRuntimeConfigurationModel,
  type RuntimeConfigurationProvider,
  type RuntimeThinkingLevel,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
} from "./runtime-configuration.ts";
import {
  getWorkflowModelOptions,
  getWorkflowThinkingOptions,
  isAllowedWorkflowRuntimeModel,
  isSafeCustomRuntimeModel,
  isWorkflowRuntimeProvider,
  supportsFastMode,
  WORKFLOW_THINKING_OPTIONS,
  type WorkflowRuntimeProvider,
  type WorkflowRuntimeReasoning,
} from "./workflow-runtime.ts";

export type RuntimeDelegationId = "claude" | "opencode" | "grok" | "codex" | "pi" | "omp";

export interface RuntimeDelegation {
  id: RuntimeDelegationId;
  label: string;
  runtime: WorkflowRuntimeProvider;
  runtimeAlias: string | null;
}

/** A user-armed delegation: runtime plus the model, thinking, and optional Fast mode. */
export interface RuntimeDelegationSelection {
  id: RuntimeDelegationId;
  model: string;
  reasoning: WorkflowRuntimeReasoning;
  /** Optional Fast mode; only meaningful when the runtime/model supports it. */
  fastMode?: boolean;
  /** Bound runtime configuration (custom or built-in) selected in settings. */
  runtimeConfigurationId?: string;
  /**
   * Composer-only range of the visible runtime token while armed.
   * Not part of the transport marker; used to keep the highlight on the chosen occurrence.
   */
  tokenStart?: number;
  tokenEnd?: number;
}

export const RUNTIME_DELEGATIONS: readonly RuntimeDelegation[] = [
  { id: "claude", label: "Claude", runtime: "claude-code", runtimeAlias: null },
  { id: "opencode", label: "OpenCode", runtime: "opencode", runtimeAlias: null },
  { id: "grok", label: "Grok", runtime: "grok-build", runtimeAlias: null },
  { id: "codex", label: "Codex", runtime: "codex-cli", runtimeAlias: null },
  { id: "pi", label: "Pi", runtime: "pi", runtimeAlias: null },
  { id: "omp", label: "OMP", runtime: "pi", runtimeAlias: "omp" },
] as const;

export type ParseRuntimeDelegationResult =
  | (RuntimeDelegation & {
      prompt: string;
      model?: string;
      reasoning?: WorkflowRuntimeReasoning;
      fastMode?: boolean;
      runtimeConfigurationId?: string;
    })
  | { error: string };

// Optional third/fourth payload slots: Fast mode and/or cfg:<runtimeConfigurationId>.
// Older markers with model;reasoning remain valid.
const RUNTIME_DELEGATION_PATTERN =
  /\$DELEGATE_(CLAUDE|OPENCODE|GROK|CODEX|PI|OMP)\b(?:\[([^;\]]+);([^;\]]+)(?:;([^;\]]+))?(?:;([^;\]]+))?\])?/gi;

const CONFIG_ID_PREFIX = "cfg:";

export const parseRuntimeDelegation = (prompt: string): ParseRuntimeDelegationResult | null => {
  const matches = [...prompt.matchAll(RUNTIME_DELEGATION_PATTERN)];
  if (matches.length === 0) return null;
  const ids = matches.map((match) => match[1]?.toLowerCase());
  if (new Set(ids).size !== 1) return { error: "Choose one delegated runtime per message." };

  const delegation = RUNTIME_DELEGATIONS.find((item) => item.id === ids[0]);
  if (!delegation) return null;
  const payload = parseDelegationPayload(
    delegation.runtime,
    matches[0]?.[2],
    matches[0]?.[3],
    matches[0]?.[4],
    matches[0]?.[5],
  );
  return {
    ...delegation,
    ...payload,
    prompt: prompt
      .replace(new RegExp(`${RUNTIME_DELEGATION_PATTERN.source}[ \\t]?`, "gi"), "")
      .trim(),
  };
};

export const formatRuntimeDelegationMarker = (selection: RuntimeDelegationSelection): string => {
  const parts = [selection.model, selection.reasoning];
  if (selection.fastMode === true) parts.push("fast");
  if (selection.runtimeConfigurationId) {
    parts.push(`${CONFIG_ID_PREFIX}${selection.runtimeConfigurationId}`);
  }
  return `$DELEGATE_${selection.id.toUpperCase()}[${parts.join(";")}]`;
};

/** Map a runtime configuration driver/command onto a built-in delegation id. */
export const runtimeConfigurationToDelegationId = (
  configuration: Pick<RuntimeConfigurationProvider, "driver" | "command">,
): RuntimeDelegationId | null => {
  if (!isWorkflowRuntimeProvider(configuration.driver)) return null;
  if (configuration.driver === "pi") {
    const command = configuration.command.trim().toLowerCase();
    if (command === "omp" || command.endsWith("/omp")) return "omp";
    return "pi";
  }
  const match = RUNTIME_DELEGATIONS.find(
    (item) => item.runtime === configuration.driver && item.runtimeAlias === null,
  );
  return match?.id ?? null;
};

/** Preferred configuration for a built-in delegation id from the ordered settings list. */
export const findDelegationRuntimeConfiguration = (
  id: RuntimeDelegationId,
  configurations: RuntimeConfigurationProvider[] | undefined,
  runtimeConfigurationId?: string,
): RuntimeConfigurationProvider | undefined =>
  findRuntimeConfiguration(configurations, {
    preferredId: runtimeConfigurationId,
    match: (configuration) => runtimeConfigurationToDelegationId(configuration) === id,
  });

/** Default model + thinking a delegation arms with before the user adjusts it. */
export const defaultDelegationSelectionFromConfiguration = (
  id: RuntimeDelegationId,
  options?: {
    tokenRange?: { start: number; end: number };
    configurations?: RuntimeConfigurationProvider[];
    runtimeConfigurationId?: string;
  },
): RuntimeDelegationSelection => {
  const runtime = RUNTIME_DELEGATIONS.find((item) => item.id === id)?.runtime ?? "claude-code";
  const configuration = findDelegationRuntimeConfiguration(
    id,
    options?.configurations,
    options?.runtimeConfigurationId,
  );
  const tokenRange = options?.tokenRange;

  if (configuration) {
    const model = getDefaultRuntimeConfigurationModel(configuration.models);
    const levels = (model?.thinkingLevels ?? []) as RuntimeThinkingLevel[];
    return {
      id,
      model: model?.model ?? getWorkflowModelOptions(runtime)[0] ?? "",
      reasoning: resolveRuntimeConfigurationReasoning(
        levels,
        null,
        model?.defaultThinkingLevel ?? null,
      ),
      fastMode: false,
      runtimeConfigurationId: configuration.id,
      ...(tokenRange ? { tokenStart: tokenRange.start, tokenEnd: tokenRange.end } : {}),
    };
  }

  const model = getWorkflowModelOptions(runtime)[0] ?? "";
  return {
    id,
    model,
    reasoning: resolveCatalogDefaultReasoning(runtime, model),
    fastMode: false,
    ...(tokenRange ? { tokenStart: tokenRange.start, tokenEnd: tokenRange.end } : {}),
  };
};

export const normalizeDelegationSelectionWithConfiguration = (
  selection: RuntimeDelegationSelection,
  configurations?: RuntimeConfigurationProvider[],
): RuntimeDelegationSelection => {
  const configuration = findDelegationRuntimeConfiguration(
    selection.id,
    configurations,
    selection.runtimeConfigurationId,
  );
  if (configuration) return normalizeConfiguredDelegation(selection, configuration);
  return normalizeCatalogDelegation(selection);
};

const normalizeConfiguredDelegation = (
  selection: RuntimeDelegationSelection,
  configuration: RuntimeConfigurationProvider,
): RuntimeDelegationSelection => {
  const modelRecord =
    configuration.models.find((item) => item.model === selection.model) ??
    getDefaultRuntimeConfigurationModel(configuration.models);
  const levels = (modelRecord?.thinkingLevels ?? []) as RuntimeThinkingLevel[];
  return {
    ...selection,
    model: modelRecord?.model ?? selection.model,
    reasoning: resolveConfiguredDelegationReasoning(selection.reasoning, levels, modelRecord),
    fastMode:
      runtimeConfigurationSupportsFastMode(configuration, modelRecord?.model ?? selection.model) &&
      selection.fastMode === true,
    runtimeConfigurationId: configuration.id,
  };
};

const resolveConfiguredDelegationReasoning = (
  current: WorkflowRuntimeReasoning,
  levels: RuntimeThinkingLevel[],
  modelRecord: { defaultThinkingLevel: RuntimeThinkingLevel | null } | undefined,
): WorkflowRuntimeReasoning => {
  if (levels.length === 0) return current;
  if (levels.includes(current as RuntimeThinkingLevel)) return current;
  return resolveRuntimeConfigurationReasoning(
    levels,
    null,
    modelRecord?.defaultThinkingLevel ?? null,
  );
};

const normalizeCatalogDelegation = (
  selection: RuntimeDelegationSelection,
): RuntimeDelegationSelection => {
  const runtime =
    RUNTIME_DELEGATIONS.find((item) => item.id === selection.id)?.runtime ?? "claude-code";
  const thinkingOptions = getWorkflowThinkingOptions(runtime, selection.model);
  const reasoning = thinkingOptions.some((option) => option.value === selection.reasoning)
    ? selection.reasoning
    : resolveCatalogDefaultReasoning(runtime, selection.model, selection.reasoning);
  const fastMode = !!(supportsFastMode(runtime, selection.model) && selection.fastMode === true);
  return { ...selection, reasoning, fastMode };
};

const parseDelegationPayload = (
  runtime: WorkflowRuntimeProvider,
  modelValue: string | undefined,
  reasoningValue: string | undefined,
  slot3: string | undefined,
  slot4: string | undefined,
): {
  model?: string;
  reasoning?: WorkflowRuntimeReasoning;
  fastMode?: boolean;
  runtimeConfigurationId?: string;
} => {
  const model = parseDelegationModel(runtime, modelValue);
  const reasoning = parseDelegationReasoning(reasoningValue);
  const extras = parseDelegationExtraSlots(slot3, slot4);
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(extras.runtimeConfigurationId
      ? { runtimeConfigurationId: extras.runtimeConfigurationId }
      : {}),
    ...(shouldKeepDelegationFastMode(runtime, model, extras) ? { fastMode: true as const } : {}),
  };
};

const shouldKeepDelegationFastMode = (
  runtime: WorkflowRuntimeProvider,
  model: string | undefined,
  extras: { fastMode: boolean; runtimeConfigurationId?: string },
): boolean => {
  if (!extras.fastMode) return false;
  // Bound config decides Fast capability on the server/UI; keep the flag for now.
  if (extras.runtimeConfigurationId) return true;
  const resolvedModel = model ?? getWorkflowModelOptions(runtime)[0] ?? "";
  return supportsFastMode(runtime, resolvedModel);
};

const parseDelegationExtraSlots = (
  slot3: string | undefined,
  slot4: string | undefined,
): { fastMode: boolean; runtimeConfigurationId?: string } => {
  let fastMode = false;
  let runtimeConfigurationId: string | undefined;
  for (const slot of [slot3, slot4]) {
    if (!slot) continue;
    const trimmed = slot.trim();
    if (trimmed.toLowerCase().startsWith(CONFIG_ID_PREFIX)) {
      const id = trimmed.slice(CONFIG_ID_PREFIX.length).trim();
      if (id) runtimeConfigurationId = id;
      continue;
    }
    if (isFastModeToken(trimmed)) fastMode = true;
  }
  return { fastMode, runtimeConfigurationId };
};

const parseDelegationModel = (
  runtime: WorkflowRuntimeProvider,
  modelValue: string | undefined,
): string | undefined => {
  const model = modelValue?.trim() ?? "";
  if (!model) return undefined;
  if (isAllowedWorkflowRuntimeModel(runtime, model) || isSafeCustomRuntimeModel(model)) {
    return model;
  }
  return undefined;
};

const parseDelegationReasoning = (
  reasoningValue: string | undefined,
): WorkflowRuntimeReasoning | undefined => {
  const reasoning = reasoningValue?.trim() ?? "";
  if (!WORKFLOW_THINKING_OPTIONS.some((option) => option.value === reasoning)) return undefined;
  return reasoning as WorkflowRuntimeReasoning;
};

const isFastModeToken = (value: string): boolean => {
  const fast = value.trim().toLowerCase();
  return fast === "fast" || fast === "true" || fast === "1";
};

const resolveCatalogDefaultReasoning = (
  runtime: WorkflowRuntimeProvider,
  model: string,
  current: WorkflowRuntimeReasoning = "medium",
): WorkflowRuntimeReasoning => {
  const options = getWorkflowThinkingOptions(runtime, model);
  if (options.some((option) => option.value === current)) return current;
  return (
    options.find((option) => option.value === "extra-high")?.value ?? options[0]?.value ?? "medium"
  );
};
