import { z } from "zod";
import { PullRequestRefSchema } from "./artifact.ts";
import { IdSchema } from "./primitives.ts";
import type { ThreadStatus } from "./thread.ts";

/**
 * How a thread card looks in the conversation. Live data (title, status line, question, PR)
 * comes from the thread itself, looked up by `threadId`, so a card never goes stale: it moves
 * from `needs-call` back to `live` when the user answers. `variant` is the look when the card
 * was posted, which is what a client renders before the thread has loaded.
 */
const ThreadCardVariantSchema = z.enum(["live", "needs-call", "done"]);
export type ThreadCardVariant = z.infer<typeof ThreadCardVariantSchema>;

// A thread that will run again is still live, whether it works, waits for a run slot, waits out
// a rate limit, or is being landed.
const LIVE_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "working",
  "queued",
  "rate-limited",
  "landing",
]);

/** The look a card has for a thread in this status: the server posts it, a client renders it live. */
export const threadCardVariant = (status: ThreadStatus): ThreadCardVariant => {
  if (status === "waiting-on-you") return "needs-call";
  return LIVE_STATUSES.has(status) ? "live" : "done";
};

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

/**
 * "Sent to 3 threads" / "Sent to one thread": which threads the coordinator routed the person's
 * message to, by starting them or by steering them. Each thread is listed once, in the order it
 * was reached, and the count in the label is their number.
 */
const RoutingReceiptBlockSchema = z.object({
  type: z.literal("routing-receipt"),
  threadIds: z
    .array(IdSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: "A thread can appear once in a receipt",
    }),
});

/** The collapsible "Message forwarded from project chat" quote at the top of a thread. */
const QuoteForwardedBlockSchema = z.object({
  type: z.literal("quote-forwarded"),
  text: z.string().min(1),
});

export const SUGGESTED_THREADS_MAX = 8;

/** One thread the coordinator proposes; the person starts it (or all of them) from the block. */
export const SuggestedThreadSchema = z.object({
  /** Stable within the block, so a client can start or dismiss one suggestion. */
  id: IdSchema,
  title: z.string().trim().min(1).max(200),
  /** Sent to the thread as its first message when the suggestion is started. */
  prompt: z.string().trim().min(1).max(8000),
  /** The repo the thread would work in; null for a thread that needs none. */
  repoId: IdSchema.nullable(),
});
export type SuggestedThread = z.infer<typeof SuggestedThreadSchema>;

/** "Suggested threads": proposals with Start and Start all buttons. Nothing runs until one is started. */
const SuggestedThreadsBlockSchema = z.object({
  type: z.literal("suggested-threads"),
  suggestions: z
    .array(SuggestedThreadSchema)
    .min(1)
    .max(SUGGESTED_THREADS_MAX)
    .refine((suggestions) => new Set(suggestions.map(({ id }) => id)).size === suggestions.length, {
      error: "A suggestion id can appear once in a block",
    }),
});

export const MessageBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThreadChipBlockSchema,
  PrChipBlockSchema,
  ThreadCardBlockSchema,
  RoutingReceiptBlockSchema,
  QuoteForwardedBlockSchema,
  SuggestedThreadsBlockSchema,
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;
