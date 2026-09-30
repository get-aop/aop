import { BlockedQuestionSchema, ThreadStepSchema } from "@aop/common";
import { z } from "zod";
import { describeServiceError } from "../project/errors.ts";
import { defineTool, describeIssues, McpToolError, textResult } from "./registry.ts";

const THREAD_STEPS_MAX = 30;
const STATUS_LINE_MAX = 200;
const OPTIONS_MAX = 8;

const OptionSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({
    label: z.string().trim().min(1).max(500),
    recommended: z.boolean().optional(),
  }),
]);

/** Tools only a thread's own agent holds: it asks for the person's call, and reports how far it is. */
export const askUserTool = defineTool({
  name: "aop_ask_user",
  description:
    "Ask the person a question you cannot proceed without. Give a clear question and, where you can, up to 8 options with at most one marked recommended. After calling this, end your turn and write nothing more: the person's answer arrives as your next message. Use it for decisions only the person can make, not for things you can look up.",
  input: z.object({
    question: z.string().trim().min(1).max(2000).describe("The question, in one or two sentences."),
    options: z
      .array(OptionSchema)
      .max(OPTIONS_MAX)
      .optional()
      .describe("The choices, as labels or {label, recommended}. Omit for an open question."),
    recommended: z
      .string()
      .optional()
      .describe("The label of the option you recommend, if you pass options as plain labels."),
  }),
  handler: async (args, { services, session }) => {
    const options = args.options?.map((option) =>
      typeof option === "string"
        ? { label: option, recommended: option === args.recommended }
        : {
            label: option.label,
            recommended: option.recommended ?? option.label === args.recommended,
          },
    );
    if (args.recommended && !options?.some((option) => option.recommended)) {
      throw new McpToolError("`recommended` must match one of the options", "INVALID_INPUT");
    }
    const question = BlockedQuestionSchema.safeParse({
      question: args.question,
      options: options ?? [],
    });
    if (!question.success) throw new McpToolError(describeIssues(question.error), "INVALID_INPUT");

    const asked = await services.threads.askUser(session.id, question.data);
    if (!asked.success) throw new McpToolError(describeServiceError(asked.error), asked.error.code);
    return textResult(
      "Your question was delivered to the person. End your turn now and write nothing more; their answer will arrive as your next message.",
    );
  },
});

export const reportStatusTool = defineTool({
  name: "aop_report_status",
  description:
    "Report your progress. Keep a short checklist of steps (each pending, active or done) and one status line, and update them as you go: the person and the coordinator see them on your thread. Send the whole checklist each time; it replaces the last one.",
  input: z
    .object({
      line: z
        .string()
        .max(STATUS_LINE_MAX)
        .nullable()
        .optional()
        .describe(
          'One line under the thread title, e.g. "Bisecting · 7 commits left". null clears it.',
        ),
      steps: z
        .array(ThreadStepSchema)
        .max(THREAD_STEPS_MAX)
        .optional()
        .describe("The whole checklist: [{label, state: pending | active | done}]."),
    })
    .refine((report) => report.line !== undefined || report.steps !== undefined, {
      error: "Send a status line, steps, or both",
    }),
  handler: async (args, { services, session }) => {
    const reported = await services.threads.reportStatus(session.id, args);
    if (!reported.success) {
      throw new McpToolError(describeServiceError(reported.error), reported.error.code);
    }
    return textResult("Status updated.");
  },
});
