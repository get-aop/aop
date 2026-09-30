import { z } from "zod";
import { PullRequestRefSchema } from "./artifact.ts";
import { IdSchema } from "./primitives.ts";

/**
 * How a thread card looks in the conversation. Live data (title, status line, question, PR)
 * comes from the thread itself, looked up by `threadId`, so a card never goes stale: it moves
 * from `needs-call` back to `live` when the user answers. `variant` is the look when the card
 * was posted, which is what a client renders before the thread has loaded.
 */
const ThreadCardVariantSchema = z.enum(["live", "needs-call", "done"]);
export type ThreadCardVariant = z.infer<typeof ThreadCardVariantSchema>;

/** Markdown prose. Adjacent inline blocks (text, thread-chip, pr-chip) flow into one paragraph. */
const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string().min(1) });

/** Inline pill for a thread mentioned in prose; the hover popover reads the thread by id. */
const ThreadChipBlockSchema = z.object({
  type: z.literal("thread-chip"),
  threadId: IdSchema,
});

/** Inline "PR #4821" pill, coloured by the pull request's state. */
const PrChipBlockSchema = PullRequestRefSchema.extend({ type: z.literal("pr-chip") });

/** Standalone card for one thread, posted when the coordinator starts, reports on, or hands over a thread. */
const ThreadCardBlockSchema = z.object({
  type: z.literal("thread-card"),
  threadId: IdSchema,
  variant: ThreadCardVariantSchema,
});

/** "Sent to 3 threads" / "Sent to one thread": how the coordinator routed the user's message. */
const RoutingReceiptBlockSchema = z.object({
  type: z.literal("routing-receipt"),
  count: z.number().int().positive(),
});

/** The collapsible "Message forwarded from project chat" quote at the top of a thread. */
const QuoteForwardedBlockSchema = z.object({
  type: z.literal("quote-forwarded"),
  text: z.string().min(1),
});

export const MessageBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThreadChipBlockSchema,
  PrChipBlockSchema,
  ThreadCardBlockSchema,
  RoutingReceiptBlockSchema,
  QuoteForwardedBlockSchema,
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;
