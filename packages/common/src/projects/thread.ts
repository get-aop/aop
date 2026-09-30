import { z } from "zod";
import { ArtifactSchema } from "./artifact.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";
import { RuntimeSelectionSchema } from "./runtime.ts";

/**
 * Where a thread runs. Phase 1 runs threads on the host only; a paired device or remote runner
 * arrives as another variant, so consumers already switch on `kind`.
 */
export const ThreadTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("host") }),
]);
export type ThreadTarget = z.infer<typeof ThreadTargetSchema>;

export const ThreadStepSchema = z.object({
  label: z.string().trim().min(1).max(500),
  state: z.enum(["pending", "active", "done"]),
});
export type ThreadStep = z.infer<typeof ThreadStepSchema>;

const BlockedOptionSchema = z.object({
  label: z.string().trim().min(1).max(500),
  recommended: z.boolean().default(false),
});

/**
 * What a thread asks when it needs the user's call. Options may be empty for an open question;
 * at most one option is recommended, so "recommended" can never point at nothing or at two.
 */
export const BlockedQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  options: z
    .array(BlockedOptionSchema)
    .refine((options) => options.filter((option) => option.recommended).length <= 1, {
      error: "At most one option can be recommended",
    }),
});
export type BlockedQuestion = z.infer<typeof BlockedQuestionSchema>;

const ThreadBaseSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().trim().min(1).max(200),
  runtime: RuntimeSelectionSchema,
  target: ThreadTargetSchema,
  repoId: IdSchema.nullable(),
  branch: z.string().min(1).nullable(),
  /** The checklist. The n/m progress ring is derived from it (see `getThreadProgress`). */
  steps: z.array(ThreadStepSchema),
  /** The one line under the title, e.g. "Bisecting · 7 commits left". */
  liveStatusLine: z.string().max(500).nullable(),
  artifacts: z.array(ArtifactSchema),
  repliesCount: z.number().int().nonnegative(),
  unread: z.boolean(),
  lastActivityAt: TimestampSchema,
  createdAt: TimestampSchema,
});

// Fields that only make sense in one status. Every other status forbids them, so a thread
// cannot be `working` and hold a question, or be `idle` and hold a resolution time.
const stateBoundFields = {
  blockedQuestion: z.never().optional(),
  resolvedAt: z.never().optional(),
  resumesAt: z.never().optional(),
};

const hasPullRequest = (artifacts: { type: string }[]): boolean =>
  artifacts.some((artifact) => artifact.type === "pr");

/**
 * A thread as the Overview and the thread pane see it. Discriminated on `status`:
 * - waiting-on-you: blocked on `blockedQuestion`, which only this status carries.
 * - working: an agent turn is running.
 * - queued: a turn is accepted but waits for a free run slot; the host runs at most a set number
 *   of thread turns at once, and queued turns start in the order they were accepted.
 * - rate-limited: the agent's CLI refused a turn because of a rate or usage limit. The thread
 *   carries `resumesAt`, when it resumes by itself (the limit's reset, or a retry time when the
 *   CLI named none); the person can resume it sooner.
 * - ready-for-review: finished, waiting for the user to look at what it produced.
 * - landing: its pull request is being driven to merge, so a `pr` artifact is required.
 * - idle: no turn running, nothing pending.
 * - resolved: closed, stamped with `resolvedAt`, which only this status carries.
 */
export const ThreadSchema = z.discriminatedUnion("status", [
  ThreadBaseSchema.extend({
    ...stateBoundFields,
    status: z.literal("waiting-on-you"),
    blockedQuestion: BlockedQuestionSchema,
  }),
  ThreadBaseSchema.extend({ ...stateBoundFields, status: z.literal("working") }),
  ThreadBaseSchema.extend({ ...stateBoundFields, status: z.literal("queued") }),
  ThreadBaseSchema.extend({
    ...stateBoundFields,
    status: z.literal("rate-limited"),
    resumesAt: TimestampSchema,
  }),
  ThreadBaseSchema.extend({ ...stateBoundFields, status: z.literal("ready-for-review") }),
  ThreadBaseSchema.extend({
    ...stateBoundFields,
    status: z.literal("landing"),
    artifacts: z.array(ArtifactSchema).refine(hasPullRequest, {
      error: "A landing thread needs a pull request",
    }),
  }),
  ThreadBaseSchema.extend({ ...stateBoundFields, status: z.literal("idle") }),
  ThreadBaseSchema.extend({
    ...stateBoundFields,
    status: z.literal("resolved"),
    resolvedAt: TimestampSchema,
  }),
]);
export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadStatus = Thread["status"];

export const THREAD_STATUSES: readonly ThreadStatus[] = ThreadSchema.options.map(
  (variant) => variant.shape.status.value,
);

/** Completed steps over total steps, or null while the thread has no checklist yet. */
export const getThreadProgress = (
  thread: Pick<Thread, "steps">,
): { done: number; total: number } | null => {
  const total = thread.steps.length;
  if (total === 0) {
    return null;
  }
  return { done: thread.steps.filter((step) => step.state === "done").length, total };
};
