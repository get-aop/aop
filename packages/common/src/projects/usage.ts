import { z } from "zod";
import { IdSchema, TimestampSchema } from "./primitives.ts";
import { CliProviderSchema } from "./runtime.ts";

const CountSchema = z.number().int().nonnegative();

/**
 * What one or more runs consumed, in the four buckets every provider's usage maps onto, so no
 * provider adds a field here. Cache reads usually dominate the counts; the Usage tab derives
 * its cache-hit share and per-thread shares from these numbers instead of receiving them.
 */
export const UsageTotalsSchema = z.object({
  inputTokens: CountSchema,
  outputTokens: CountSchema,
  cacheWriteTokens: CountSchema,
  cacheReadTokens: CountSchema,
  /** Sum of the costs providers reported. Null when no run in the total reported one. */
  costUsd: z.number().nonnegative().nullable(),
  /** Runs that recorded usage into this total. */
  runs: CountSchema,
});
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

/** The totals of one model. A run or thread that used several models has one entry per model. */
export const ModelUsageSchema = UsageTotalsSchema.extend({
  provider: CliProviderSchema,
  model: z.string().min(1),
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

/**
 * The instants a total covers, by when each run finished: `since` inclusive, `until` exclusive.
 * A missing bound is open, and the read routes echo the bounds they applied.
 */
export const UsageWindowSchema = z
  .object({ since: TimestampSchema.nullable(), until: TimestampSchema.nullable() })
  .refine(
    ({ since, until }) => since === null || until === null || Date.parse(since) < Date.parse(until),
    { error: "since must be earlier than until" },
  );
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const RunUsageSchema = z.object({
  runId: IdSchema,
  /** A thread is a chat session, so this is the thread's id. */
  threadId: IdSchema,
  totals: UsageTotalsSchema,
  byModel: z.array(ModelUsageSchema),
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

/** Every run of one thread (or of a project's coordinator) inside the window. */
export const ThreadUsageSchema = z.object({
  threadId: IdSchema,
  window: UsageWindowSchema,
  totals: UsageTotalsSchema,
  byModel: z.array(ModelUsageSchema),
});
export type ThreadUsage = z.infer<typeof ThreadUsageSchema>;

/** One row of the Usage tab: a session of the project with everything it consumed. */
export const ProjectUsageThreadSchema = UsageTotalsSchema.extend({
  threadId: IdSchema,
  kind: z.enum(["coordinator", "thread"]),
  title: z.string(),
  /** Models the session used, the one with the most tokens first. */
  models: z.array(z.string().min(1)),
  /** When the session's latest run in the window finished. */
  lastRunAt: TimestampSchema,
});
export type ProjectUsageThread = z.infer<typeof ProjectUsageThreadSchema>;

/**
 * Lines added and removed, as a thread's changes panel counts them: its worktree against where
 * its branch left the default branch. Binary files add nothing.
 */
const CodeChangesSchema = z.object({ additions: CountSchema, deletions: CountSchema });
export type CodeChanges = z.infer<typeof CodeChangesSchema>;

/**
 * A project's usage inside the window: the coordinator and every thread, largest consumer
 * first. A session that recorded no usage inside the window has no row.
 */
export const ProjectUsageSchema = z.object({
  projectId: IdSchema,
  window: UsageWindowSchema,
  totals: UsageTotalsSchema,
  byModel: z.array(ModelUsageSchema),
  threads: z.array(ProjectUsageThreadSchema),
  /**
   * What the threads with runs in the window have changed, read from their worktrees when asked;
   * a thread whose worktree is gone (resolved, merged) adds nothing.
   */
  codeChanges: CodeChangesSchema,
});
export type ProjectUsage = z.infer<typeof ProjectUsageSchema>;
