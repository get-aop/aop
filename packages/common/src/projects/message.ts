import { z } from "zod";
import { MessageBlockSchema } from "./blocks.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";

const MessageBaseSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  /** The conversation this message belongs to: a thread's id, or null for the project's coordinator chat. */
  threadId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});

/** Typed by the person; plain text. */
export const UserMessageSchema = MessageBaseSchema.extend({
  role: z.literal("user"),
  text: z.string().min(1),
});

/**
 * Written by an agent: the coordinator, a thread's agent, or the coordinator relaying the
 * user's message into a thread (blocks: quote-forwarded, then the brief as text).
 */
export const AssistantMessageSchema = MessageBaseSchema.extend({
  role: z.literal("assistant"),
  blocks: z.array(MessageBlockSchema).min(1),
});

/** What a thread told the coordinator. */
export const ThreadReportOutcomeSchema = z.enum(["finished", "needs-you", "failed"]);
export type ThreadReportOutcome = z.infer<typeof ThreadReportOutcomeSchema>;

/**
 * Written by the server, not by the person or a model: a thread finished a turn, asked for
 * the person's call, or failed. It sits in the coordinator chat (`threadId` is null) and wakes
 * the coordinator, so it is shown as an event line and never as something the person typed.
 */
export const ThreadReportMessageSchema = MessageBaseSchema.extend({
  role: z.literal("thread-report"),
  threadId: z.null(),
  reportedThreadId: IdSchema,
  outcome: ThreadReportOutcomeSchema,
  text: z.string().min(1),
});

export const MessageSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AssistantMessageSchema,
  ThreadReportMessageSchema,
]);
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ThreadReportMessage = z.infer<typeof ThreadReportMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;
