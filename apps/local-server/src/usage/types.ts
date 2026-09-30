/**
 * What one model consumed during one run, in the four buckets every provider's usage maps
 * onto. A provider's log parser produces these; nothing after it knows which provider spoke.
 */
export interface RunUsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** The cost the provider reported; null when it reported none. */
  costUsd: number | null;
}

/** Reads a finished (or killed) run's log. Returns nothing when the log holds no usage. */
export type UsageParser = (log: string) => RunUsageEntry[];
