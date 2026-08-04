import { parseRawJsonlContent } from "./parser";
import type { LogProvider, ParsedRawLogEntry } from "./types";

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  provider?: string;
  model?: string;
  raw?: Record<string, unknown>;
}

interface AccumulatedUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  costUsd: number | undefined;
  provider: string | undefined;
  model: string | undefined;
  hasAny: boolean;
}

export const extractUsageFromRawJsonl = (content: string): RunUsage | undefined => {
  if (!content.trim()) return undefined;

  const parsed = parseRawJsonlContent(content);
  const accumulated = accumulateUsage(parsed.entries);

  if (!accumulated.hasAny) return undefined;

  const totalTokens =
    accumulated.totalTokens ??
    (accumulated.inputTokens !== undefined || accumulated.outputTokens !== undefined
      ? (accumulated.inputTokens ?? 0) + (accumulated.outputTokens ?? 0)
      : undefined);

  return {
    inputTokens: accumulated.inputTokens,
    outputTokens: accumulated.outputTokens,
    totalTokens,
    costUsd: accumulated.costUsd,
    provider: accumulated.provider,
    model: accumulated.model,
  };
};

const accumulateUsage = (entries: ParsedRawLogEntry[]): AccumulatedUsage => {
  const state: AccumulatedUsage = {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    costUsd: undefined,
    provider: undefined,
    model: undefined,
    hasAny: false,
  };

  for (const entry of entries) {
    accumulateProvider(state, entry);
    accumulateUsageObject(state, entry.event);
    accumulateEventCost(state, entry.event);
    if (typeof entry.event.model === "string" && !state.model) {
      state.model = entry.event.model;
    }
  }

  return state;
};

const accumulateProvider = (state: AccumulatedUsage, entry: ParsedRawLogEntry): void => {
  if (state.provider) return;
  if (entry.provider && entry.provider !== "unknown") {
    state.provider = entry.provider;
  } else {
    state.provider = inferProviderFromEvent(entry.event);
  }
};

const accumulateUsageObject = (state: AccumulatedUsage, event: Record<string, unknown>): void => {
  const usage = findUsageObject(event);
  if (!usage) return;

  const input = extractTokenValue(usage, ["input_tokens", "prompt_tokens"]);
  const output = extractTokenValue(usage, ["output_tokens", "completion_tokens"]);
  const total = extractTokenValue(usage, ["total_tokens"]);

  state.inputTokens = sumIfPresent(state.inputTokens, input);
  state.outputTokens = sumIfPresent(state.outputTokens, output);
  state.totalTokens = sumIfPresent(state.totalTokens, total);
  state.costUsd = accumulateCost(state.costUsd, usage.cost_usd);
  if (typeof usage.model === "string" && !state.model) {
    state.model = usage.model;
  }
  state.hasAny = state.hasAny || input !== undefined || output !== undefined || total !== undefined;
};

const accumulateEventCost = (state: AccumulatedUsage, event: Record<string, unknown>): void => {
  const eventCost = findNumericField(event, ["total_cost_usd", "cost_usd"]);
  if (eventCost !== undefined) {
    state.costUsd = sumIfPresent(state.costUsd, eventCost);
    state.hasAny = true;
  }
};

const accumulateCost = (current: number | undefined, value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isNaN(value)) return current;
  return sumIfPresent(current, value);
};

const findUsageObject = (event: Record<string, unknown>): Record<string, unknown> | null => {
  if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) {
    return event.usage as Record<string, unknown>;
  }
  return null;
};

const extractTokenValue = (usage: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
};

const findNumericField = (event: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
};

const sumIfPresent = (
  current: number | undefined,
  value: number | undefined,
): number | undefined => {
  if (value === undefined) return current;
  if (current === undefined) return value;
  return current + value;
};

const inferProviderFromEvent = (event: Record<string, unknown>): string | undefined => {
  const type = event.type;
  if (typeof type !== "string") return undefined;

  if (type === "result" || type === "assistant") return "claude-code";
  if (type === "turn.completed" || type === "item.completed") return "codex-cli";
  if (type === "finish" || type === "text" || type === "tool_use") return "opencode";
  if (type === "agent_end" || type === "message_end" || type === "tool_execution_end") {
    return "pi";
  }

  return undefined;
};

export const resolveProviderName = (
  provider: LogProvider | string | undefined,
): string | undefined => {
  if (!provider || provider === "unknown") return undefined;
  return provider;
};
