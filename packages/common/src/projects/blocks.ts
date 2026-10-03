import { z } from "zod";
import { ArtifactPartSchema } from "../artifacts.ts";
import { PullRequestRefSchema } from "./artifact.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";
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

/**
 * Markdown prose. Adjacent inline blocks (text, thread-chip, pr-chip) flow into one paragraph. A
 * coordinator writes a thread into its text as `[title](thread:<id>)`, which a client shows as a chip.
 */
const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string().min(1) });

export const TOOL_NAME_MAX_LENGTH = 200;
export const TOOL_DETAIL_MAX_LENGTH = 300;

/**
 * One tool call of the turn, where the agent made it. What the tool returned is not part of it:
 * it can be large and private.
 */
const ToolBlockSchema = z.object({
  type: z.literal("tool"),
  /** The runtime's id for the call, unique within the turn. */
  id: z.string().min(1),
  /** The tool or command as the runtime names it: "Bash", "Read", "mcp aop thread spawn". */
  name: z.string().min(1).max(TOOL_NAME_MAX_LENGTH),
  /** What it was asked to do, e.g. the command line or the file path. */
  detail: z.string().max(TOOL_DETAIL_MAX_LENGTH).nullable(),
  status: z.enum(["running", "done", "failed"]),
  /**
   * When the host saw the call start, on a turn being written: how long the step a message sent
   * meanwhile waits on has run. A finished reply has none.
   */
  startedAt: TimestampSchema.optional(),
});

/** What the model reasoned before it went on, shown folded. */
const ThinkingBlockSchema = z.object({ type: z.literal("thinking"), text: z.string().min(1) });

/**
 * A message that reached the turn while it worked, where the agent took it in: the user message
 * `messageId`, which the reply shows at this point instead of on its own.
 */
const SteerBlockSchema = z.object({ type: z.literal("steer"), messageId: IdSchema });

/**
 * One part of what an agent's turn produced, in the order it produced them: prose, a tool call,
 * reasoning, a message the turn took in as it went, or an artifact one of its tools made. A reply is its parts followed by the
 * blocks its tools posted (cards, receipts, proposals), and a turn being written is the same
 * parts, growing.
 */
export const TurnPartSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ToolBlockSchema,
  ThinkingBlockSchema,
  SteerBlockSchema,
  ArtifactPartSchema,
]);
export type TurnPart = z.infer<typeof TurnPartSchema>;
export type ToolPart = Extract<TurnPart, { type: "tool" }>;
export type SteerPart = Extract<TurnPart, { type: "steer" }>;
/** A part that is prose the agent wrote: text or reasoning. */
export type ProsePart = Extract<TurnPart, { type: "text" | "thinking" }>;

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

export const SUGGESTED_THREADS_MAX = 8;
/** A reason is one line under the title, so it is kept to what one line holds. */
export const SUGGESTION_REASON_MAX = 140;

/**
 * What the person did with a proposal, as the host recorded it: started as this thread, or
 * skipped. A started proposal stays started; a skip can be taken back.
 */
export const SuggestionAnswerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("started"), threadId: IdSchema }),
  z.object({ state: z.literal("skipped") }),
]);
export type SuggestionAnswer = z.infer<typeof SuggestionAnswerSchema>;

/** One thread the coordinator proposes; the person starts it (or all of them) from the block. */
export const SuggestedThreadSchema = z.object({
  /** Stable within the block, so a client can start or dismiss one suggestion. */
  id: IdSchema,
  title: z.string().trim().min(1).max(200),
  /** Sent to the thread as its first message when the suggestion is started. */
  prompt: z.string().trim().min(1).max(8000),
  /**
   * The one line the person reads under the title: why this thread is worth starting. Absent on
   * proposals stored before reasons existed, which show their title alone.
   */
  reason: z.string().trim().min(1).max(SUGGESTION_REASON_MAX).optional(),
  /** The repo the thread would work in; null for a thread that needs none. */
  repoId: IdSchema.nullable(),
  /**
   * Not stored with the block: the host adds it, from its record of answers, to every message it
   * sends. Absent while nobody has answered.
   */
  answer: SuggestionAnswerSchema.optional(),
});
export type SuggestedThread = z.infer<typeof SuggestedThreadSchema>;

/** "Suggested threads": proposals to start one by one or all at once, or skip. Nothing runs until one is started. */
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

export const QUESTION_OPTIONS_MIN = 2;
export const QUESTION_OPTIONS_MAX = 5;
/** An option is a button the person clicks, so it is kept to what a short button holds. */
export const QUESTION_OPTION_MAX = 120;
export const QUESTION_MAX = 1000;

/** One answer the person can give with a click. Clicking it sends `label` as their reply. */
export const QuestionOptionSchema = z.object({
  label: z.string().trim().min(1).max(QUESTION_OPTION_MAX),
  recommended: z.boolean().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

/**
 * A question the coordinator asks the person, with the answers it expects as buttons under its
 * reply; `other` adds one that puts the cursor in the box for an answer of their own. Nothing is
 * stored when it is answered: the person's next message is the answer, and a client reads the
 * question as answered once a message of theirs follows it (an option, if the text is its label).
 */
const QuestionBlockSchema = z.object({
  type: z.literal("question"),
  question: z.string().trim().min(1).max(QUESTION_MAX),
  options: z
    .array(QuestionOptionSchema)
    .min(QUESTION_OPTIONS_MIN)
    .max(QUESTION_OPTIONS_MAX)
    .refine((options) => options.filter((option) => option.recommended).length <= 1, {
      error: "At most one option can be recommended",
    })
    .refine((options) => new Set(options.map(({ label }) => label)).size === options.length, {
      error: "Each option needs a label of its own",
    }),
  other: z.boolean(),
});
export type QuestionBlock = z.infer<typeof QuestionBlockSchema>;

export const MessageBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ToolBlockSchema,
  ThinkingBlockSchema,
  SteerBlockSchema,
  ArtifactPartSchema,
  ThreadChipBlockSchema,
  PrChipBlockSchema,
  ThreadCardBlockSchema,
  RoutingReceiptBlockSchema,
  SuggestedThreadsBlockSchema,
  QuestionBlockSchema,
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;
