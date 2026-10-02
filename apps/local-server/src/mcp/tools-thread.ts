import { BlockedQuestionSchema, THREAD_WAIT_REASON_MAX, ThreadStepSchema } from "@aop/common";
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
    "Ask the person a question you cannot proceed without. Give a clear question and, where you can, up to 8 options with at most one marked recommended. After calling this, end your turn and write nothing more: the person's answer arrives as your next message. Use it for decisions only the person can make, not for things you can look up. When you wait on the person to do something outside AOP (approve a deployment, log in, provide a secret) and can keep checking for it yourself, use aop_report_status with waitingOn instead.",
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

const WaitingOnSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(THREAD_WAIT_REASON_MAX)
    .describe(
      'What the person has to do, in one short sentence, e.g. "Approve the production deployment on GitHub".',
    ),
  link: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional()
    .describe("Where they do it: the page to open, if there is one."),
});

export const reportStatusTool = defineTool({
  name: "aop_report_status",
  description:
    "Report your progress. Keep a short checklist of steps (each pending, active or done) and one status line, and update them as you go: the person and the coordinator see them on your thread. Send the whole checklist each time; it replaces the last one. When you are blocked on the person for something outside AOP (a GitHub approval, a login, a secret) but keep working or polling, add waitingOn: your thread shows as waiting on the person with the reason and link, and the coordinator is told at once. Do not end your turn for it. It clears when you report again without waitingOn, or when your turn ends.",
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
      waitingOn: WaitingOnSchema.optional().describe(
        "Set while you wait on the person for something outside AOP and keep going. Leave it out once the wait is over.",
      ),
    })
    .refine(
      (report) =>
        report.line !== undefined || report.steps !== undefined || report.waitingOn !== undefined,
      { error: "Send a status line, steps, waitingOn, or several" },
    ),
  handler: async (args, { services, session }) => {
    const reported = await services.threads.reportStatus(session.id, args);
    if (!reported.success) {
      throw new McpToolError(describeServiceError(reported.error), reported.error.code);
    }
    const { thread } = reported;
    if (thread.status === "working" && thread.waitingOn) {
      return textResult(
        "Status updated. You show as waiting on the person, and the coordinator knows. Keep working or checking; report again without waitingOn once it is done.",
      );
    }
    return textResult("Status updated.");
  },
});

export const openPullRequestTool = defineTool({
  name: "aop_open_pr",
  description:
    "Open the pull request for your work: your changes are committed, your branch is pushed, and a pull request is opened against the default branch. Call it when the work is ready for review. Called again, it commits and pushes what you did since and returns the same pull request; once that pull request has merged or closed it is refused, and further work belongs in a new thread. Give a title and a short description of what changed and why. Leave them out to have them written from your conversation. Never push to or merge into the default branch yourself.",
  input: z.object({
    title: z.string().trim().min(1).max(200).optional().describe("The pull request title."),
    body: z.string().max(10_000).optional().describe("The description, in markdown."),
    draft: z.boolean().optional().describe("Open it as a draft."),
  }),
  handler: async (args, { services, session }) => {
    const opened = await services.threads.openPullRequest(session.id, args);
    if (!opened.success) {
      throw new McpToolError(describeServiceError(opened.error), opened.error.code);
    }
    return textResult({ pullRequest: opened.pullRequest, created: opened.created });
  },
});
