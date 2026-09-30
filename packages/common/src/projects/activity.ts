import { z } from "zod";
import { IdSchema } from "./primitives.ts";

export const ACTIVITY_LABEL_MAX_LENGTH = 200;
export const ACTIVITY_DETAIL_MAX_LENGTH = 300;
export const ACTIVITY_NARRATION_MAX_LENGTH = 4000;
export const ACTIVITY_ROWS_PER_TURN_MAX = 200;
export const ACTIVITY_TURNS_MAX = 30;

/** One tool call of a turn. What the tool returned is not part of it: it can be large and private. */
export const ActivityRowSchema = z.object({
  id: z.string().min(1),
  /** The tool or command, as the runtime names it: "Bash", "Read", "mcp__aop__thread_spawn". */
  label: z.string().min(1).max(ACTIVITY_LABEL_MAX_LENGTH),
  /** What it was asked to do, e.g. the command line or the file path. */
  detail: z.string().max(ACTIVITY_DETAIL_MAX_LENGTH).nullable(),
  status: z.enum(["running", "done", "failed"]),
});
export type ActivityRow = z.infer<typeof ActivityRowSchema>;

/** A batch of consecutive tool calls: the runtime calls tools between the paragraphs it says. */
export const ActivityGroupSchema = z.object({
  id: z.string().min(1),
  rows: z.array(ActivityRowSchema).min(1),
});
export type ActivityGroup = z.infer<typeof ActivityGroupSchema>;

/**
 * What one turn of a thread did besides its final message: the status paragraphs it said while
 * working, and the tool calls it made. It is keyed by the assistant message the turn produced, and
 * a running turn by the id that message will have, which is the `messageId` of its live text.
 */
export const ThreadTurnActivitySchema = z
  .object({
    messageId: IdSchema,
    running: z.boolean(),
    /** Status paragraphs said between tool calls, without the final answer; empty when none. */
    narration: z.string().max(ACTIVITY_NARRATION_MAX_LENGTH),
    groups: z.array(ActivityGroupSchema),
  })
  .refine(
    ({ groups }) =>
      groups.reduce((count, group) => count + group.rows.length, 0) <= ACTIVITY_ROWS_PER_TURN_MAX,
    { error: `A turn holds at most ${ACTIVITY_ROWS_PER_TURN_MAX} tool calls` },
  );
export type ThreadTurnActivity = z.infer<typeof ThreadTurnActivitySchema>;

/** The latest turns of a thread that did something, oldest first; a running turn is last. */
export const ThreadActivitySchema = z.object({
  turns: z.array(ThreadTurnActivitySchema).max(ACTIVITY_TURNS_MAX),
});
export type ThreadActivity = z.infer<typeof ThreadActivitySchema>;
