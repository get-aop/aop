import type { CliProvider } from "@aop/common";
import type { Generated, Selectable } from "kysely";

export interface RunUsageTable {
  run_id: string;
  model: string;
  provider: CliProvider;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  /** Null when the provider reported no cost. */
  cost_usd: number | null;
  /** When the run finished, in `Date.toISOString()` form. */
  recorded_at: Generated<string>;
}

export interface UsageDatabase {
  run_usage: RunUsageTable;
}

export type RunUsageRow = Selectable<RunUsageTable>;
