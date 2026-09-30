import type { ReasoningEffort } from "../projects/runtime.ts";
import {
  isAllowedRuntimeModel,
  isSafeCustomRuntimeModel,
  THINKING_OPTIONS,
} from "./runtime-catalog.ts";

type ControlProvider = "claude-code";
type ControlCapability = "browser" | "computer";

export interface ControlCommand {
  id: "CC_BROWSER_USE" | "CC_COMPUTER_USE";
  provider: ControlProvider;
  capability: ControlCapability;
}

/** Armed control command: capability plus the model/thinking (and optional fast mode) to run with. */
interface ControlCommandSelection {
  id: ControlCommand["id"];
  model: string;
  reasoning: ReasoningEffort;
  fastMode: boolean;
  /** Bound runtime configuration from settings (same source as % delegation). */
  runtimeConfigurationId?: string;
}

const CONTROL_COMMANDS: readonly ControlCommand[] = [
  { id: "CC_BROWSER_USE", provider: "claude-code", capability: "browser" },
  { id: "CC_COMPUTER_USE", provider: "claude-code", capability: "computer" },
];

type ParseControlCommandResult =
  | {
      command: Omit<ControlCommand, "id"> & {
        model?: string;
        reasoning?: ReasoningEffort;
        fastMode?: boolean;
        runtimeConfigurationId?: string;
      };
      prompt: string;
    }
  | { error: string };

// `$CC_BROWSER_USE` or `$CC_BROWSER_USE[model;reasoning]` or with fast and/or cfg:<id>
const CONTROL_COMMAND_PATTERN =
  /\$(CC_BROWSER_USE|CC_COMPUTER_USE)\b(?:\[([^;\]]+);([^;\]]+)(?:;([^;\]]+))?(?:;([^;\]]+))?\])?/gi;

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

const parseControlPayload = (
  provider: ControlProvider,
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
  const model = parseControlModel(provider, modelValue);
  const reasoning = parseControlReasoning(reasoningValue);
  const extras = parseControlExtraSlots(slot3, slot4);
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(extras.runtimeConfigurationId
      ? { runtimeConfigurationId: extras.runtimeConfigurationId }
      : {}),
    ...(extras.fastMode && extras.runtimeConfigurationId ? { fastMode: true as const } : {}),
  };
};

const parseControlModel = (
  provider: ControlProvider,
  modelValue: string | undefined,
): string | undefined => {
  const model = modelValue?.trim() ?? "";
  if (!model) return undefined;
  if (isAllowedRuntimeModel(provider, model) || isSafeCustomRuntimeModel(model)) {
    return model;
  }
  return undefined;
};

const parseControlReasoning = (reasoningValue: string | undefined): ReasoningEffort | undefined => {
  const reasoning = reasoningValue?.trim() ?? "";
  if (!THINKING_OPTIONS.some((option) => option.value === reasoning)) return undefined;
  return reasoning as ReasoningEffort;
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
