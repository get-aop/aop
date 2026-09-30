/**
 * Migration v3: usage accounting, added on top of v2. Versions 1 and 2 are never edited.
 *
 * run_usage holds what one chat run consumed, one row per model, in four token buckets
 * that every provider's usage maps onto (input, output, cache write, cache read) plus the
 * cost the provider reported. Nothing in it is specific to Claude Code: a provider is a
 * value in `provider`, so Codex and PI need a log parser, not a column.
 *
 * A thread's or a project's usage is never stored: it is summed from these rows through
 * chat_runs and chat_sessions, so a total cannot drift from the runs it adds up.
 *
 * - CASCADE run_usage.run_id: the rows are derived from the run's log and name no
 *   external resource, so deleting a run, or the session that owns it, removes them.
 * - No CHECK lists the values of `provider`, for the reason projects-v2.ts gives: the
 *   catalog is typed in @aop/common and validated where usage is read.
 * - cost_usd is null when the provider reported no cost. A reported zero stays zero.
 * - recorded_at is when the run finished, and is what a time window filters on. It uses
 *   the ISO-8601 form `Date.toISOString()` writes, so string order is time order.
 */
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const USAGE_V3_STATEMENTS: readonly string[] = [
  `CREATE TABLE run_usage (
    run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
    cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
    cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
    recorded_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    CONSTRAINT pk_run_usage PRIMARY KEY (run_id, model)
  )`,
  // Time windows across every run of a project or thread.
  `CREATE INDEX idx_run_usage_recorded_at ON run_usage(recorded_at)`,
];
