import { z } from "zod";
import { IdSchema, TimestampSchema } from "../projects/primitives.ts";
import { ReasoningEffortSchema } from "../projects/runtime.ts";
import { RoutineScheduleSchema } from "./schedule.ts";

/**
 * A routine: work a project does on a schedule, like a morning digest or a weekly report. Each
 * time it comes due the host starts a thread with its brief, or sends it to the coordinator.
 */

export const ROUTINE_NAME_MAX = 120;
export const ROUTINE_PROMPT_MAX = 8000;
/** Runs more often than this are refused unless the host owner lowers the setting. */
export const DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES = 15;
export const DEFAULT_ROUTINE_MAX_ACTIVE = 10;
/** How many runs of one routine the host keeps; older ones are dropped. */
export const ROUTINE_HISTORY_MAX = 50;

/** `thread` starts a new thread with the brief; `coordinator` sends it to the project chat. */
export const RoutineTargetSchema = z.enum(["thread", "coordinator"]);
export type RoutineTarget = z.infer<typeof RoutineTargetSchema>;

/** Runs missed while the host was off: `skip` records them as missed, `run-once` runs once on start. */
export const RoutineCatchUpSchema = z.enum(["skip", "run-once"]);
export type RoutineCatchUp = z.infer<typeof RoutineCatchUpSchema>;

const RoutineFieldsSchema = z.object({
  name: z.string().trim().min(1, { error: "Give the routine a name" }).max(ROUTINE_NAME_MAX),
  prompt: z
    .string()
    .trim()
    .min(1, { error: "Write what the routine should do" })
    .max(ROUTINE_PROMPT_MAX)
    .describe("The brief each run gets: complete, since a run cannot see earlier conversations."),
  schedule: RoutineScheduleSchema,
  target: RoutineTargetSchema,
  /** A thread's repository; null takes the project's only one. */
  repoId: IdSchema.nullable(),
  /** A thread's model and effort; null uses the project's thread settings. */
  model: z.string().trim().min(1).max(200).nullable(),
  effort: ReasoningEffortSchema.nullable(),
  enabled: z.boolean(),
  catchUp: RoutineCatchUpSchema,
});

export const RoutineInputSchema = RoutineFieldsSchema.extend({
  target: RoutineTargetSchema.default("thread"),
  repoId: IdSchema.nullable().default(null),
  model: z.string().trim().min(1).max(200).nullable().default(null),
  effort: ReasoningEffortSchema.nullable().default(null),
  enabled: z.boolean().default(true),
  catchUp: RoutineCatchUpSchema.default("skip"),
});
export type RoutineInput = z.input<typeof RoutineInputSchema>;
export type ParsedRoutineInput = z.output<typeof RoutineInputSchema>;

export const RoutinePatchSchema = RoutineFieldsSchema.partial().refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { error: "Send at least one field to change" },
);
export type RoutinePatch = z.infer<typeof RoutinePatchSchema>;

/**
 * How a run went. `running`, `ok` and `failed` are a started run, read from the turn it started;
 * `skipped` (the previous run still working, the project paused, a usage limit with
 * auto-continue off), `missed` (the host was off) and `deferred` (waiting for a usage limit to
 * reset) never started anything.
 */
export const RoutineRunStatusSchema = z.enum([
  "running",
  "ok",
  "failed",
  "skipped",
  "missed",
  "deferred",
]);
export type RoutineRunStatus = z.infer<typeof RoutineRunStatusSchema>;

export const RoutineRunTriggerSchema = z.enum(["schedule", "manual", "catch-up"]);
export type RoutineRunTrigger = z.infer<typeof RoutineRunTriggerSchema>;

export const RoutineRunSchema = z.object({
  id: IdSchema,
  routineId: IdSchema,
  /** The occurrence the run is for: its scheduled time, or when "Run now" was pressed. */
  occurrence: TimestampSchema,
  trigger: RoutineRunTriggerSchema,
  status: RoutineRunStatusSchema,
  /** Why it was skipped, missed, deferred or failed, in a sentence. */
  reason: z.string().nullable(),
  /** The thread a `thread` routine started. */
  threadId: IdSchema.nullable(),
  /** The coordinator message a `coordinator` routine sent. */
  messageId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

export const RoutineCreatorSchema = z.enum(["person", "coordinator"]);

export const RoutineSchema = RoutineFieldsSchema.extend({
  id: IdSchema,
  projectId: IdSchema,
  /** Null while paused, or when the schedule never comes round again. */
  nextRunAt: TimestampSchema.nullable(),
  lastRun: RoutineRunSchema.nullable(),
  createdBy: RoutineCreatorSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Routine = z.infer<typeof RoutineSchema>;

/** The caps the host applies, so a form can say them before it is refused. */
export const RoutineLimitsSchema = z.object({
  minIntervalMinutes: z.number().int().positive(),
  maxActive: z.number().int().positive(),
});
export type RoutineLimits = z.infer<typeof RoutineLimitsSchema>;

/** `GET /api/projects/:id/routines`. `timeZone` is the host's: every schedule is read on it. */
export const RoutinesResponseSchema = z.object({
  routines: z.array(RoutineSchema),
  timeZone: z.string(),
  limits: RoutineLimitsSchema,
});
export type RoutinesResponse = z.infer<typeof RoutinesResponseSchema>;

export const RoutineRunsResponseSchema = z.object({ runs: z.array(RoutineRunSchema) });

/** `POST /api/projects/:id/routines/preview`: a schedule's words and next runs on the host's clock. */
export const SchedulePreviewSchema = z.object({
  description: z.string(),
  nextRuns: z.array(TimestampSchema),
  timeZone: z.string(),
  /** Why the host would refuse it (too frequent), or null. */
  problem: z.string().nullable(),
});
export type SchedulePreview = z.infer<typeof SchedulePreviewSchema>;
