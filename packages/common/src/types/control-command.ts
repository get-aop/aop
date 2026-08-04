import {
  findRuntimeConfiguration,
  type RuntimeConfigurationProvider,
  type RuntimeThinkingLevel,
  resolveConfiguredModelRecord,
  resolveConfiguredProviderDefaults,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
} from "./runtime-configuration.ts";
import {
  getDefaultWorkflowRuntimeModel,
  getDefaultWorkflowRuntimeReasoning,
  getWorkflowModelOptions,
  getWorkflowThinkingOptions,
  isAllowedWorkflowRuntimeModel,
  isSafeCustomRuntimeModel,
  supportsFastMode,
  WORKFLOW_THINKING_OPTIONS,
  type WorkflowRuntimeReasoning,
} from "./workflow-runtime.ts";

export type ControlProvider = "claude-code" | "codex-cli";
export type ControlCapability = "browser" | "computer";

export interface ControlCommand {
  id: "CC_BROWSER_USE" | "CX_BROWSER_USE" | "CC_COMPUTER_USE" | "CX_COMPUTER_USE";
  provider: ControlProvider;
  capability: ControlCapability;
}

/** Armed control command: capability plus the model/thinking (and optional fast mode) to run with. */
export interface ControlCommandSelection {
  id: ControlCommand["id"];
  model: string;
  reasoning: WorkflowRuntimeReasoning;
  fastMode: boolean;
  /** Bound runtime configuration from settings (same source as % delegation). */
  runtimeConfigurationId?: string;
}

export const CONTROL_COMMANDS: readonly ControlCommand[] = [
  { id: "CC_BROWSER_USE", provider: "claude-code", capability: "browser" },
  { id: "CX_BROWSER_USE", provider: "codex-cli", capability: "browser" },
  { id: "CC_COMPUTER_USE", provider: "claude-code", capability: "computer" },
  { id: "CX_COMPUTER_USE", provider: "codex-cli", capability: "computer" },
];

/** Human-readable label for menus and typeahead (e.g. "Claude Browser"). */
export const controlCommandLabel = (
  command: Pick<ControlCommand, "provider" | "capability">,
): string => {
  const providerLabel = command.provider === "claude-code" ? "Claude" : "Codex";
  const capabilityLabel = command.capability === "browser" ? "Browser" : "Computer";
  return `${providerLabel} ${capabilityLabel}`;
};

export type ParseControlCommandResult =
  | {
      command: Omit<ControlCommand, "id"> & {
        model?: string;
        reasoning?: WorkflowRuntimeReasoning;
        fastMode?: boolean;
        runtimeConfigurationId?: string;
      };
      prompt: string;
    }
  | { error: string };

// `$CX_BROWSER_USE` or `$CX_BROWSER_USE[model;reasoning]` or with fast and/or cfg:<id>
const CONTROL_COMMAND_PATTERN =
  /\$(CC_BROWSER_USE|CX_BROWSER_USE|CC_COMPUTER_USE|CX_COMPUTER_USE)\b(?:\[([^;\]]+);([^;\]]+)(?:;([^;\]]+))?(?:;([^;\]]+))?\])?/gi;

const CONFIG_ID_PREFIX = "cfg:";

export const parseControlCommand = (prompt: string): ParseControlCommandResult | null => {
  const matches = [...prompt.matchAll(CONTROL_COMMAND_PATTERN)];
  if (matches.length === 0) return null;
  const ids = matches.map((match) => match[1]?.toUpperCase());
  if (new Set(ids).size !== 1) {
    return { error: "Use one computer or browser control command per message." };
  }

  const command = CONTROL_COMMANDS.find((item) => item.id === ids[0]);
  if (!command) return null;
  const payload = parseControlPayload(
    command.provider,
    matches[0]?.[2],
    matches[0]?.[3],
    matches[0]?.[4],
    matches[0]?.[5],
  );

  return {
    command: {
      provider: command.provider,
      capability: command.capability,
      ...payload,
    },
    prompt: prompt.replace(new RegExp(`${CONTROL_COMMAND_PATTERN.source}[ \\t]?`, "gi"), "").trim(),
  };
};

export const formatControlCommandMarker = (selection: ControlCommandSelection): string => {
  const parts = [selection.model, selection.reasoning];
  if (selection.fastMode) parts.push("fast");
  if (selection.runtimeConfigurationId) {
    parts.push(`${CONFIG_ID_PREFIX}${selection.runtimeConfigurationId}`);
  }
  return `$${selection.id}[${parts.join(";")}]`;
};

/**
 * Default control selection from runtime configuration.
 * `preferredConfigurationId` (e.g. the active chat session config) is used only when its
 * driver matches the control command provider — same multi-profile rule as chat/% surfaces.
 */
export const defaultControlSelection = (
  id: ControlCommand["id"],
  configurations?: RuntimeConfigurationProvider[],
  preferredConfigurationId?: string | null,
): ControlCommandSelection | null => {
  const command = CONTROL_COMMANDS.find((item) => item.id === id);
  if (!command) return null;
  const preferredId = preferredControlConfigurationId(
    command.provider,
    configurations,
    preferredConfigurationId,
  );
  const defaults = resolveConfiguredProviderDefaults(command.provider, configurations, preferredId);
  return {
    id,
    model: defaults.model || getDefaultWorkflowRuntimeModel(command.provider, ""),
    reasoning: defaults.reasoning,
    fastMode: false,
    ...(defaults.configuration ? { runtimeConfigurationId: defaults.configuration.id } : {}),
  };
};

/** Prefer the session/runtime profile when it belongs to the control provider family. */
export const preferredControlConfigurationId = (
  provider: ControlProvider,
  configurations: RuntimeConfigurationProvider[] | undefined,
  preferredConfigurationId?: string | null,
): string | undefined => {
  if (!preferredConfigurationId || !configurations?.length) return undefined;
  const preferred = configurations.find((item) => item.id === preferredConfigurationId);
  if (!preferred || preferred.driver !== provider || preferred.models.length === 0) {
    return undefined;
  }
  return preferred.id;
};

/** Keep selection valid against runtime configuration (or catalog fallback). */
export const normalizeControlSelection = (
  selection: ControlCommandSelection,
  configurations?: RuntimeConfigurationProvider[],
): ControlCommandSelection => {
  const command = CONTROL_COMMANDS.find((item) => item.id === selection.id);
  if (!command) return selection;
  const preferredId = preferredControlConfigurationId(
    command.provider,
    configurations,
    selection.runtimeConfigurationId,
  );
  const configuration = findRuntimeConfiguration(configurations, {
    preferredId,
    driver: command.provider,
  });
  if (configuration) return normalizeControlAgainstConfiguration(selection, configuration);
  return normalizeControlAgainstCatalog(selection, command.provider);
};

const normalizeControlAgainstConfiguration = (
  selection: ControlCommandSelection,
  configuration: RuntimeConfigurationProvider,
): ControlCommandSelection => {
  const modelRecord = resolveConfiguredModelRecord(configuration, selection.model);
  if (!modelRecord) {
    return {
      ...selection,
      fastMode:
        runtimeConfigurationSupportsFastMode(configuration, selection.model) && selection.fastMode,
      runtimeConfigurationId: configuration.id,
    };
  }
  const levels = modelRecord.thinkingLevels as RuntimeThinkingLevel[];
  const reasoning = resolveControlReasoning(
    selection.reasoning,
    levels,
    modelRecord.defaultThinkingLevel ?? null,
  );
  return {
    ...selection,
    model: modelRecord.model,
    reasoning,
    fastMode:
      runtimeConfigurationSupportsFastMode(configuration, modelRecord.model) && selection.fastMode,
    runtimeConfigurationId: configuration.id,
  };
};

const resolveControlReasoning = (
  current: WorkflowRuntimeReasoning,
  levels: RuntimeThinkingLevel[],
  defaultThinkingLevel: RuntimeThinkingLevel | null,
): WorkflowRuntimeReasoning => {
  if (levels.length === 0) return current;
  if (levels.includes(current as RuntimeThinkingLevel)) return current;
  return resolveRuntimeConfigurationReasoning(levels, null, defaultThinkingLevel);
};

const normalizeControlAgainstCatalog = (
  selection: ControlCommandSelection,
  provider: ControlProvider,
): ControlCommandSelection => {
  const models = getWorkflowModelOptions(provider);
  const model = models.includes(selection.model)
    ? selection.model
    : (getDefaultWorkflowRuntimeModel(provider, "") ?? selection.model);
  const thinking = getWorkflowThinkingOptions(provider, model);
  const reasoning = thinking.some((option) => option.value === selection.reasoning)
    ? selection.reasoning
    : getDefaultWorkflowRuntimeReasoning(provider, model, selection.reasoning);
  return {
    ...selection,
    model,
    reasoning,
    fastMode: supportsFastMode(provider, model) && selection.fastMode,
  };
};

export const rewriteControlCommandMarker = (
  content: string,
  selection: ControlCommandSelection,
): string => {
  const pattern = new RegExp(`\\$${selection.id}\\b(?:\\[[^\\]]*\\])?`, "i");
  if (!pattern.test(content)) {
    return `${content} ${formatControlCommandMarker(selection)}`.trim();
  }
  return content.replace(pattern, formatControlCommandMarker(selection));
};

const parseControlPayload = (
  provider: ControlProvider,
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
  const model = parseControlModel(provider, modelValue);
  const reasoning = parseControlReasoning(reasoningValue);
  const extras = parseControlExtraSlots(slot3, slot4);
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(extras.runtimeConfigurationId
      ? { runtimeConfigurationId: extras.runtimeConfigurationId }
      : {}),
    ...(shouldKeepControlFast(provider, extras) ? { fastMode: true as const } : {}),
  };
};

const parseControlModel = (
  provider: ControlProvider,
  modelValue: string | undefined,
): string | undefined => {
  const model = modelValue?.trim() ?? "";
  if (!model) return undefined;
  if (isAllowedWorkflowRuntimeModel(provider, model) || isSafeCustomRuntimeModel(model)) {
    return model;
  }
  return undefined;
};

const parseControlReasoning = (
  reasoningValue: string | undefined,
): WorkflowRuntimeReasoning | undefined => {
  const reasoning = reasoningValue?.trim() ?? "";
  if (!WORKFLOW_THINKING_OPTIONS.some((option) => option.value === reasoning)) return undefined;
  return reasoning as WorkflowRuntimeReasoning;
};

const shouldKeepControlFast = (
  provider: ControlProvider,
  extras: { fastMode: boolean; runtimeConfigurationId?: string },
): boolean => {
  if (!extras.fastMode) return false;
  // Keep Fast when a config is bound; catalog Fast only for codex without config.
  return Boolean(extras.runtimeConfigurationId) || provider === "codex-cli";
};

const parseControlExtraSlots = (
  slot3: string | undefined,
  slot4: string | undefined,
): { fastMode: boolean; runtimeConfigurationId?: string } => {
  let fastMode = false;
  let runtimeConfigurationId: string | undefined;
  for (const slot of [slot3, slot4]) {
    const parsed = parseControlExtraToken(slot);
    if (parsed.kind === "cfg") runtimeConfigurationId = parsed.id;
    if (parsed.kind === "fast") fastMode = true;
  }
  return { fastMode, runtimeConfigurationId };
};

const parseControlExtraToken = (
  slot: string | undefined,
): { kind: "cfg"; id: string } | { kind: "fast" } | { kind: "none" } => {
  if (!slot) return { kind: "none" };
  const trimmed = slot.trim();
  if (trimmed.toLowerCase().startsWith(CONFIG_ID_PREFIX)) {
    const id = trimmed.slice(CONFIG_ID_PREFIX.length).trim();
    return id ? { kind: "cfg", id } : { kind: "none" };
  }
  const lower = trimmed.toLowerCase();
  if (lower === "fast" || lower === "true") return { kind: "fast" };
  return { kind: "none" };
};
