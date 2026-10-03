import {
  type MessageBlock,
  MessageBlockSchema,
  QUESTION_MAX,
  QUESTION_OPTION_MAX,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
} from "@aop/common";
import { z } from "zod";
import { createRunBlocks } from "../project/run-blocks.ts";
import { defineTool, describeIssues, McpToolError, textResult } from "./registry.ts";

const OptionSchema = z.union([
  z.string().trim().min(1).max(QUESTION_OPTION_MAX),
  z.object({
    label: z.string().trim().min(1).max(QUESTION_OPTION_MAX),
    recommended: z.boolean().optional(),
  }),
]);

/**
 * The coordinator's question for the person, answered with a click: the options show as buttons
 * under its reply, and the one clicked is sent as the person's next message. Threads have
 * aop_ask_user instead, which also puts the thread on "waiting on you".
 */
export const askPersonTool = defineTool({
  name: "ask_person",
  description: `Ask the person a question they answer with a click: yes or no, pick one of a few, "merge it by itself or wait for you?". The chat shows the question under your reply with each option as a button, and the person's choice arrives as their next message, word for word the option's label. Give ${QUESTION_OPTIONS_MIN} to ${QUESTION_OPTIONS_MAX} short options, at most one marked recommended, and set other when an answer of their own makes sense too. Do not also write the question or the options in your text. After calling it, end your turn. To offer starting threads, use propose_threads instead.`,
  input: z.object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(QUESTION_MAX)
      .describe("The question, in one or two sentences."),
    options: z
      .array(OptionSchema)
      .min(QUESTION_OPTIONS_MIN)
      .max(QUESTION_OPTIONS_MAX)
      .describe(
        `The answers, as labels or {label, recommended}: ${QUESTION_OPTIONS_MIN} to ${QUESTION_OPTIONS_MAX}, a few words each.`,
      ),
    recommended: z
      .string()
      .optional()
      .describe("The label of the option you recommend, if you pass options as plain labels."),
    other: z
      .boolean()
      .optional()
      .describe('Add an "Other" button for an answer the person types themselves.'),
  }),
  handler: async (args, { ctx, session }) => {
    const block = questionBlock(args);
    const attached = await createRunBlocks(ctx.db).append(session.id, block);
    if (!attached) {
      throw new McpToolError("No reply is being written to attach the question to", "NO_RUN");
    }
    return textResult(
      "The person sees your question with its options as buttons. End your turn now; their answer arrives as their next message.",
    );
  },
});

const questionBlock = (args: {
  question: string;
  options: Array<string | { label: string; recommended?: boolean }>;
  recommended?: string;
  other?: boolean;
}): MessageBlock => {
  const options = args.options.map((option) => {
    const label = typeof option === "string" ? option : option.label;
    const recommended =
      (typeof option !== "string" && option.recommended) || label === args.recommended;
    return recommended ? { label, recommended: true } : { label };
  });
  if (args.recommended && !options.some(({ label }) => label === args.recommended)) {
    throw new McpToolError("`recommended` must match one of the options", "INVALID_INPUT");
  }
  const block = MessageBlockSchema.safeParse({
    type: "question",
    question: args.question,
    options,
    other: args.other ?? false,
  });
  if (!block.success) throw new McpToolError(describeIssues(block.error), "INVALID_INPUT");
  return block.data;
};
