import { parseRawJsonlContent, type RawProviderEvent } from "@aop/llm-provider";
import type { RunUsageEntry } from "./types.ts";

const UNKNOWN_MODEL = "unknown";
// Claude Code writes assistant messages with this model and zero usage for its own errors.
const SYNTHETIC_MODEL = "<synthetic>";

type Fields = Record<string, unknown>;

/**
 * Usage from a Claude Code `--output-format stream-json` log.
 *
 * The `result` event closes a run and is authoritative: `modelUsage` splits the run's tokens
 * and cost by model (helper models such as a title generator show up as their own key), and
 * `usage` plus `total_cost_usd` cover the run as a whole. A process that answered a steer with a
 * turn of its own writes a result per turn (`result_index` 0, 1, ...), and each result's
 * `modelUsage` and cost add up every turn of the process so far, so only its last one counts.
 * A run that was stopped or crashed
 * has no `result`; its tokens are then summed from the `usage` of its assistant messages,
 * keeping one entry per message id because the CLI repeats a message once per content block.
 * That path knows no cost.
 */
export const parseClaudeCodeUsage = (log: string): RunUsageEntry[] => {
  const events = parseRawJsonlContent(log).entries.map((entry) => entry.event);
  const fallbackModel = modelOf(events);
  const fromResults = mergeByModel(
    lastResultOfEachProcess(events).flatMap((result) => resultEntries(result, fallbackModel)),
  );
  return fromResults.length > 0 ? fromResults : mergeByModel(assistantEntries(events));
};

// A result whose `result_index` is above 0 continues the process of the result before it. A log
// holds several processes when a run was retried on a fresh session.
const lastResultOfEachProcess = (events: RawProviderEvent[]): RawProviderEvent[] => {
  const last: RawProviderEvent[] = [];
  for (const event of events) {
    if (event.type !== "result") continue;
    const continues = typeof event.result_index === "number" && event.result_index > 0;
    if (continues && last.length > 0) last[last.length - 1] = event;
    else last.push(event);
  }
  return last;
};

const resultEntries = (result: RawProviderEvent, fallbackModel: string): RunUsageEntry[] => {
  const perModel = asFields(result.modelUsage);
  const entries = perModel
    ? Object.entries(perModel).flatMap(([model, usage]) => {
        const fields = asFields(usage);
        return fields ? [modelUsageEntry(model, fields)] : [];
      })
    : [];
  if (entries.length > 0) return entries.filter(hasUsage);

  const usage = asFields(result.usage);
  if (!usage) return [];
  const total = tokenEntry(fallbackModel, usage, cost(result.total_cost_usd));
  return hasUsage(total) ? [total] : [];
};

// `modelUsage` is camelCase, unlike the snake_case `usage` beside it.
const modelUsageEntry = (model: string, fields: Fields): RunUsageEntry => ({
  model: modelName(model),
  inputTokens: count(fields.inputTokens),
  outputTokens: count(fields.outputTokens),
  cacheWriteTokens: count(fields.cacheCreationInputTokens),
  cacheReadTokens: count(fields.cacheReadInputTokens),
  costUsd: cost(fields.costUSD),
});

const tokenEntry = (model: string, usage: Fields, costUsd: number | null): RunUsageEntry => ({
  model,
  inputTokens: count(usage.input_tokens),
  outputTokens: count(usage.output_tokens),
  cacheWriteTokens: count(usage.cache_creation_input_tokens),
  cacheReadTokens: count(usage.cache_read_input_tokens),
  costUsd,
});

const assistantEntries = (events: RawProviderEvent[]): RunUsageEntry[] => {
  const byMessage = new Map<string, RunUsageEntry>();
  for (const event of events) {
    const message = assistantMessageUsage(event);
    if (message) byMessage.set(message.id, message.entry);
  }
  return [...byMessage.values()].filter(hasUsage);
};

const assistantMessageUsage = (
  event: RawProviderEvent,
): { id: string; entry: RunUsageEntry } | undefined => {
  const message = event.type === "assistant" ? asFields(event.message) : undefined;
  const usage = asFields(message?.usage);
  if (!message || !usage || typeof message.id !== "string") return undefined;
  if (message.model === SYNTHETIC_MODEL) return undefined;
  return { id: message.id, entry: tokenEntry(modelName(message.model), usage, null) };
};

// The model an old CLI without `modelUsage` ran on: what its last real assistant message or
// its init event named.
const modelOf = (events: RawProviderEvent[]): string => {
  for (const event of [...events].reverse()) {
    const model = event.type === "assistant" ? asFields(event.message)?.model : event.model;
    if (typeof model === "string" && model && model !== SYNTHETIC_MODEL) return model;
  }
  return UNKNOWN_MODEL;
};

/** One entry per model: a log with several results (a retried run) adds them up. */
const mergeByModel = (entries: RunUsageEntry[]): RunUsageEntry[] => {
  const merged = new Map<string, RunUsageEntry>();
  for (const entry of entries) {
    const known = merged.get(entry.model);
    merged.set(entry.model, known ? add(known, entry) : entry);
  }
  return [...merged.values()];
};

const add = (a: RunUsageEntry, b: RunUsageEntry): RunUsageEntry => ({
  model: a.model,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  costUsd: a.costUsd === null && b.costUsd === null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
});

const hasUsage = (entry: RunUsageEntry): boolean =>
  entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens + entry.cacheReadTokens > 0;

const asFields = (value: unknown): Fields | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;

const modelName = (value: unknown): string =>
  typeof value === "string" && value ? value : UNKNOWN_MODEL;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const cost = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
