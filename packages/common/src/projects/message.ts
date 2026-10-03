import { z } from "zod";
import { CHAT_IMAGE_LIMITS } from "../types/chat-image.ts";
import { MessageBlockSchema } from "./blocks.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";

const MessageBaseSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  /** The conversation this message belongs to: a thread's id, or null for the project's coordinator chat. */
  threadId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});

/** An image the person attached to a message. `path` is where the host serves it, under `/api`. */
export const MessageImageSchema = z.object({
  id: IdSchema,
  mimeType: z.enum(CHAT_IMAGE_LIMITS.allowedMimeTypes),
  path: z.string().startsWith("/"),
});

/**
 * The reply a message steers: it was written into that reply's turn while the turn ran, so it
 * needs no reply of its own and is shown inside that reply, where the reply's `steer` part for it
 * says the agent took it in (at the reply's end until then). Absent on a message that waits for a
 * turn of its own, or started one.
 */
const SteersSchema = IdSchema.optional();

/**
 * Who sent a message the agent takes in: the person (typed in a composer), the coordinator (a
 * thread's brief, or a steer), one of the person's routines, or AOP itself (a pull request fix,
 * a new project's survey).
 */
export const MessageSenderSchema = z.enum(["person", "coordinator", "routine", "system"]);

/**
 * What an agent was told: plain text, and the images the person attached. A message of images
 * alone has no text. `sender` says who wrote it; a host from before senders were recorded sends
 * none, and the chat shows such a message as the person's. `routine` marks one a routine sent on
 * the person's behalf: its brief, as they wrote it. `quote` is the person's own words that the
 * coordinator forwards with its message, and `brief` marks a thread's first message, the brief
 * it works from.
 */
export const UserMessageSchema = MessageBaseSchema.extend({
  role: z.literal("user"),
  text: z.string(),
  images: z.array(MessageImageSchema).min(1).optional(),
  steers: SteersSchema,
  sender: MessageSenderSchema.optional(),
  routine: z.object({ id: IdSchema, name: z.string() }).optional(),
  quote: z.string().min(1).optional(),
  brief: z.literal(true).optional(),
}).refine((message) => message.text.length > 0 || message.images !== undefined, {
  message: "A message needs text or an image",
  path: ["text"],
});

/** Written by an agent: the coordinator, or a thread's agent. */
export const AssistantMessageSchema = MessageBaseSchema.extend({
  role: z.literal("assistant"),
  blocks: z.array(MessageBlockSchema).min(1),
  /** The run that wrote this reply failed and the text says why. A usage-limit wait is not a failure. */
  failed: z.literal(true).optional(),
  /**
   * The message this reply answers, which is where it sits in the conversation. A reply to
   * several thread reports that arrived together answers the newest of them. Absent on a message
   * no run wrote (the host's welcome on a new project).
   */
  inReplyTo: IdSchema.optional(),
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
export type MessageSender = z.infer<typeof MessageSenderSchema>;
export type MessageImage = z.infer<typeof MessageImageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ThreadReportMessage = z.infer<typeof ThreadReportMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;

/** One page of a conversation, oldest first; `hasMore` says older messages exist before the first. */
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}
