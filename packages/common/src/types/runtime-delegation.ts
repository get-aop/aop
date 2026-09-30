import type { CliProvider, ReasoningEffort } from "../projects/runtime.ts";
import {
  getRuntimeModelOptions,
  isAllowedRuntimeModel,
  isSafeCustomRuntimeModel,
  supportsFastMode,
  THINKING_OPTIONS,
} from "./runtime-catalog.ts";

type RuntimeDelegationId = "claude";

export interface RuntimeDelegation {
  id: RuntimeDelegationId;
  label: string;
  runtime: CliProvider;
  runtimeAlias: string | null;
}

/** A user-armed delegation: runtime plus the model, thinking, and optional Fast mode. */
interface RuntimeDelegationSelection {
  id: RuntimeDelegationId;
  model: string;
  reasoning: ReasoningEffort;
  /** Optional Fast mode; only meaningful when the runtime/model supports it. */
  fastMode?: boolean;
  /** Bound runtime configuration (custom or built-in) selected in settings. */
  runtimeConfigurationId?: string;
}

const RUNTIME_DELEGATIONS: readonly RuntimeDelegation[] = [
  { id: "claude", label: "Claude", runtime: "claude-code", runtimeAlias: null },
] as const;

type ParseRuntimeDelegationResult =
  | (RuntimeDelegation & {
      prompt: string;
      model?: string;
      reasoning?: ReasoningEffort;
      fastMode?: boolean;
      runtimeConfigurationId?: string;
    })
  | { error: string };

// Optional third/fourth payload slots: Fast mode and/or cfg:<runtimeConfigurationId>.
// Older markers with model;reasoning remain valid.
const RUNTIME_DELEGATION_PATTERN =
  /\$DELEGATE_(CLAUDE)\b(?:\[([^;\]]+);([^;\]]+)(?:;([^;\]]+))?(?:;([^;\]]+))?\])?/gi;

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

const parseDelegationPayload = (
  runtime: CliProvider,
  modelValue: string | undefined,
  reasoningValue: string | undefined,
  slot3: string | undefined,
  slot4: string | undefined,
): {
  model?: string;
  reasoning?: ReasoningEffort;
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
  runtime: CliProvider,
  model: string | undefined,
  extras: { fastMode: boolean; runtimeConfigurationId?: string },
): boolean => {
  if (!extras.fastMode) return false;
  // Bound config decides Fast capability on the server/UI; keep the flag for now.
  if (extras.runtimeConfigurationId) return true;
  const resolvedModel = model ?? getRuntimeModelOptions(runtime)[0] ?? "";
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
  runtime: CliProvider,
  modelValue: string | undefined,
): string | undefined => {
  const model = modelValue?.trim() ?? "";
  if (!model) return undefined;
  if (isAllowedRuntimeModel(runtime, model) || isSafeCustomRuntimeModel(model)) {
    return model;
  }
  return undefined;
};

const parseDelegationReasoning = (
  reasoningValue: string | undefined,
): ReasoningEffort | undefined => {
  const reasoning = reasoningValue?.trim() ?? "";
  if (!THINKING_OPTIONS.some((option) => option.value === reasoning)) return undefined;
  return reasoning as ReasoningEffort;
};

const isFastModeToken = (value: string): boolean => {
  const fast = value.trim().toLowerCase();
  return fast === "fast" || fast === "true" || fast === "1";
};
