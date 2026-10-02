import { z } from "zod";
import { TimestampSchema } from "./projects/primitives.ts";

/**
 * One of the Claude plan's rolling limits, as Claude Code last reported it: the share of the
 * window's allowance used, and when the window resets. A reset time in the past means the window
 * has rolled over since, so its use is back to zero.
 */
export const PlanWindowSchema = z.object({
  usedPercent: z.number().min(0).max(100),
  resetsAt: TimestampSchema.nullable(),
});
export type PlanWindow = z.infer<typeof PlanWindowSchema>;

/**
 * The person's Claude plan usage against its two limits, the 5-hour session window and the
 * 7-day window. The host reads it from what Claude Code writes while it runs, so it is as fresh
 * as the latest run: `updatedAt` says when that was.
 */
export const PlanUsageSchema = z.object({
  fiveHour: PlanWindowSchema.nullable(),
  sevenDay: PlanWindowSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type PlanUsage = z.infer<typeof PlanUsageSchema>;

/** `GET /api/usage/plan`. Null until a run has reported the plan's usage (an API key never does). */
export const PlanUsageResponseSchema = z.object({ usage: PlanUsageSchema.nullable() });
export type PlanUsageResponse = z.infer<typeof PlanUsageResponseSchema>;
