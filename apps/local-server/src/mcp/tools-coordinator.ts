import {
  getThreadProgress,
  type Message,
  NotificationLevelSchema,
  type ProjectPatch,
  ReasoningEffortSchema,
  SUGGESTED_THREADS_MAX,
  SUGGESTION_REASON_MAX,
  THREAD_STATUSES,
  type Thread,
} from "@aop/common";
import { z } from "zod";
import { describeServiceError } from "../project/errors.ts";
import { createRunBlocks } from "../project/run-blocks.ts";
import { defineTool, type McpToolCall, McpToolError, textResult } from "./registry.ts";

/** The coordinator's tools: it routes work to threads and keeps the project's memory and settings. */

const REPORT_MESSAGES_DEFAULT = 6;
const REPORT_MESSAGES_MAX = 20;
const REPORT_TEXT_MAX = 4000;

const projectIdOf = ({ session }: McpToolCall): string => {
  if (!session.project_id)
    throw new McpToolError("This session belongs to no project", "NO_PROJECT");
  return session.project_id;
};

// A thread id from a model may name another project's thread; only this project's are visible.
const ownThread = async (call: McpToolCall, threadId: string): Promise<Thread> => {
  const found = await call.services.threads.get(threadId);
  if (!found.success || found.thread.projectId !== projectIdOf(call)) {
    throw new McpToolError("Thread not found in this project", "THREAD_NOT_FOUND");
  }
  return found.thread;
};

const unwrap = <T extends { success: boolean }>(result: T): Extract<T, { success: true }> => {
  if (result.success) return result as Extract<T, { success: true }>;
  const { error } = result as unknown as { error: Parameters<typeof describeServiceError>[0] };
  throw new McpToolError(describeServiceError(error), error.code);
};

const summarize = (thread: Thread) => ({
  id: thread.id,
  title: thread.title,
  status: thread.status,
  statusLine: thread.liveStatusLine,
  progress: getThreadProgress(thread),
  repoId: thread.repoId,
  branch: thread.branch,
  pullRequest: thread.artifacts.find((artifact) => artifact.type === "pr") ?? null,
  ...(thread.status === "waiting-on-you" ? { blockedQuestion: thread.blockedQuestion } : {}),
  // A rate-limited thread resumes by itself at this time; the coordinator has no need to steer it.
  ...(thread.status === "rate-limited" ? { resumesAt: thread.resumesAt } : {}),
  lastActivityAt: thread.lastActivityAt,
});

export const threadSpawnTool = defineTool({
  name: "thread_spawn",
  description:
    "Start a thread: a separate agent session that does one piece of work in one repository and reports back. It cannot see this conversation, so `prompt` must be a complete brief: the goal, the constraints, and what done looks like. Returns at once; the thread's report arrives later as a message.",
  input: z.object({
    prompt: z.string().min(1).describe("The thread's first message: a complete brief."),
    title: z
      .string()
      .max(200)
      .optional()
      .describe("A short title. Defaults to the first line of the prompt."),
    repoId: z
      .string()
      .optional()
      .describe("The repository the thread works in. Required when the project has several."),
    quote: z
      .string()
      .optional()
      .describe("The person's own words, when this forwards what they said; shown as a quote."),
  }),
  handler: async (args, call) => {
    const { thread } = unwrap(await call.services.threads.spawn(projectIdOf(call), args));
    const blocks = createRunBlocks(call.ctx.db);
    await blocks.append(call.session.id, {
      type: "thread-card",
      threadId: thread.id,
      variant: "live",
    });
    await blocks.routedTo(call.session.id, thread.id);
    return textResult(summarize(thread));
  },
});

export const threadSteerTool = defineTool({
  name: "thread_steer",
  description:
    "Send a message to an existing thread: new instructions, an answer to what it reported, or a change of direction. Queued if the thread is working, otherwise it starts another turn. Reopens a resolved thread.",
  input: z.object({
    threadId: z.string(),
    message: z.string().min(1),
    quote: z
      .string()
      .optional()
      .describe("The person's own words, when this forwards what they said."),
  }),
  handler: async (args, call) => {
    await ownThread(call, args.threadId);
    const { thread } = unwrap(
      await call.services.threads.send(args.threadId, args.message, {
        type: "coordinator-relay",
        quote: args.quote?.trim() || null,
      }),
    );
    await createRunBlocks(call.ctx.db).routedTo(call.session.id, thread.id);
    return textResult(summarize(thread));
  },
});

export const threadStopTool = defineTool({
  name: "thread_stop",
  description:
    "Stop a thread: its running turn is ended and its queued messages are dropped. The thread stays and can be steered again.",
  input: z.object({ threadId: z.string() }),
  handler: async (args, call) => {
    await ownThread(call, args.threadId);
    return textResult(summarize(unwrap(await call.services.threads.stop(args.threadId)).thread));
  },
});

export const threadOpenPrTool = defineTool({
  name: "thread_open_pr",
  description:
    "Open the pull request for a thread's work: its changes are committed, its branch is pushed and a pull request is opened against the default branch. A thread has one pull request, so asking again pushes what the thread did since and returns the same one; once it has merged or closed, start a new thread for further work. Use it when the person asks for a pull request or the thread's work is ready for one. Give a title and description when you know them; leave them out to have them written from the thread's conversation.",
  input: z.object({
    threadId: z.string(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(10_000).optional().describe("The description, in markdown."),
    draft: z.boolean().optional().describe("Open it as a draft."),
  }),
  handler: async ({ threadId, ...pullRequest }, call) => {
    await ownThread(call, threadId);
    const opened = unwrap(await call.services.threads.openPullRequest(threadId, pullRequest));
    return textResult({
      pullRequest: opened.pullRequest,
      created: opened.created,
      thread: summarize(opened.thread),
    });
  },
});

export const threadMergePrTool = defineTool({
  name: "thread_merge_pr",
  description:
    "Merge a thread's pull request, when the person asks you to. Once it is merged the thread is resolved and its branch is cleaned up. It is refused while the thread is working, while the thread holds work its pull request lacks (have it pushed with thread_open_pr first), and when GitHub says the pull request is not ready (failing checks, conflicts, a review still needed); tell the person why and, if it helps, steer the thread to fix it.",
  input: z.object({
    threadId: z.string(),
    method: z.enum(["squash", "merge", "rebase"]).optional().describe("Defaults to squash."),
  }),
  handler: async (args, call) => {
    await ownThread(call, args.threadId);
    const merged = unwrap(
      await call.services.threads.mergePullRequest(args.threadId, { method: args.method }),
    );
    return textResult(summarize(merged.thread));
  },
});

export const threadResolveTool = defineTool({
  name: "thread_resolve",
  description:
    "Mark a thread resolved when its work is done and nothing more is wanted from it. Its worktree is removed and its branch kept, and a later thread_steer reopens it. It is refused while the thread is working: stop it first.",
  input: z.object({ threadId: z.string() }),
  handler: async (args, call) => {
    await ownThread(call, args.threadId);
    return textResult(summarize(unwrap(await call.services.threads.resolve(args.threadId)).thread));
  },
});

export const threadListTool = defineTool({
  name: "thread_list",
  description:
    "List this project's threads, most recent activity first, with status, one-line progress, and the question of any thread waiting on the person.",
  input: z.object({
    status: z
      .enum(THREAD_STATUSES as [string, ...string[]])
      .optional()
      .describe("Only threads in this status."),
  }),
  handler: async (args, call) => {
    const { threads } = unwrap(await call.services.threads.list(projectIdOf(call)));
    const shown = args.status ? threads.filter((thread) => thread.status === args.status) : threads;
    return textResult({ threads: shown.map(summarize) });
  },
});

export const threadReportTool = defineTool({
  name: "thread_report",
  description:
    "Read one thread in detail: its state and the end of its transcript. Use it to answer the person about a thread or decide how to steer it; a thread's own reports already reach you as messages.",
  input: z.object({
    threadId: z.string(),
    messages: z
      .number()
      .int()
      .min(1)
      .max(REPORT_MESSAGES_MAX)
      .optional()
      .describe(`How many recent messages to include (default ${REPORT_MESSAGES_DEFAULT}).`),
  }),
  handler: async (args, call) => {
    const thread = await ownThread(call, args.threadId);
    const { messages } = unwrap(await call.services.threads.listMessages(args.threadId));
    const recent = messages.slice(-(args.messages ?? REPORT_MESSAGES_DEFAULT));
    return textResult({ thread: summarize(thread), recent: recent.map(readable) });
  },
});

const readable = (message: Message) => {
  const text =
    message.role === "assistant"
      ? message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n")
      : message.text;
  return {
    from: message.role === "user" ? "person" : "thread",
    at: message.createdAt,
    text: text.length <= REPORT_TEXT_MAX ? text : `${text.slice(0, REPORT_TEXT_MAX)}…`,
  };
};

export const proposeThreadsTool = defineTool({
  name: "propose_threads",
  description:
    "Suggest threads instead of starting them: the person sees each as its title and one line of reason, and starts one, several or all of them. Use it when the work could go several ways or the person should choose. Nothing runs until they start one.",
  input: z.object({
    threads: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          prompt: z.string().min(1).max(8000).describe("The complete brief the thread would get."),
          reason: z
            .string()
            .trim()
            .min(1)
            .max(SUGGESTION_REASON_MAX)
            .describe(
              "One short sentence the person reads under the title: why this thread is worth starting now. Not the brief.",
            ),
          repoId: z.string().optional(),
        }),
      )
      .min(1)
      .max(SUGGESTED_THREADS_MAX),
  }),
  handler: async (args, call) => {
    const project = unwrap(await call.services.projects.get(projectIdOf(call))).project;
    for (const { repoId } of args.threads) {
      if (repoId && !project.repoIds.includes(repoId)) {
        throw new McpToolError(
          `Repository ${repoId} is not one of this project's repositories`,
          "REPO_NOT_IN_PROJECT",
        );
      }
    }
    const attached = await createRunBlocks(call.ctx.db).append(call.session.id, {
      type: "suggested-threads",
      suggestions: args.threads.map((thread) => ({
        id: crypto.randomUUID(),
        title: thread.title,
        prompt: thread.prompt,
        reason: thread.reason,
        repoId: thread.repoId ?? null,
      })),
    });
    if (!attached)
      throw new McpToolError("No reply is being written to attach the proposals to", "NO_RUN");
    return textResult(
      `Proposed ${args.threads.length} thread(s). Nothing runs until the person starts one.`,
    );
  },
});

export const projectSettingsGetTool = defineTool({
  name: "project_settings_get",
  description:
    "Read the project's settings: goal, instructions, the models and effort for you and for threads, notification level, thread access, whether pull requests are fixed automatically, and its repositories.",
  input: z.object({}),
  handler: async (_args, call) => {
    const { project } = unwrap(await call.services.projects.get(projectIdOf(call)));
    const repos = await Promise.all(
      project.repoIds.map((id) => call.ctx.repoRepository.getById(id)),
    );
    return textResult({
      name: project.name,
      status: project.status,
      goal: project.goal,
      instructions: project.instructions,
      coordinator: project.coordinator,
      thread: project.thread,
      notificationLevel: project.notificationLevel,
      threadAccess: project.threadAccess,
      autoFixPullRequests: project.autoFixPullRequests,
      repos: repos.flatMap((repo) =>
        repo ? [{ id: repo.id, name: repo.name, path: repo.path }] : [],
      ),
    });
  },
});

// What the coordinator may change: how threads run and how loudly they are reported. The goal and
// the instructions are the person's: they are system-prompt text of every session (see
// project/system-prompt.ts), so a coordinator that reads thread reports and user text must not be
// able to rewrite them; its own channel for what it learns is memory, which sessions read as data.
// Thread access, repositories and the coordinator's own runtime stay with the person too. The
// schema is strict, so a call naming any of these fails with a message instead of being trimmed
// to the settings that remain and reported as done.
const SETTINGS_OF_THE_PERSON =
  "Only the person changes the goal, the instructions, thread access, the repositories and whether pull requests are fixed automatically; here you can set threadModel, threadEffort and notificationLevel. Save what you learn with memory_write.";

export const projectSettingsSetTool = defineTool({
  name: "project_settings_set",
  description:
    "Change how threads run, when the person asks: the model and effort they use, or the notification level. Omit what should stay. The goal, the instructions, thread access, the repositories and whether pull requests are fixed automatically can only be changed by the person.",
  input: z
    .strictObject(
      {
        threadModel: z
          .string()
          .nullable()
          .optional()
          .describe("null passes no model, so Claude Code uses its own default."),
        threadEffort: ReasoningEffortSchema.nullable()
          .optional()
          .describe("null passes no effort, so Claude Code uses its own default."),
        notificationLevel: NotificationLevelSchema.optional(),
      },
      {
        error: (issue) => (issue.code === "unrecognized_keys" ? SETTINGS_OF_THE_PERSON : undefined),
      },
    )
    .refine((settings) => Object.values(settings).some((value) => value !== undefined), {
      error: "Send at least one setting to change",
    }),
  handler: async (args, call) => {
    const projectId = projectIdOf(call);
    const { project } = unwrap(await call.services.projects.get(projectId));
    const patch: ProjectPatch = {
      ...(args.notificationLevel !== undefined && { notificationLevel: args.notificationLevel }),
      ...((args.threadModel !== undefined || args.threadEffort !== undefined) && {
        thread: {
          ...project.thread,
          ...(args.threadModel !== undefined && { model: args.threadModel }),
          ...(args.threadEffort !== undefined && { effort: args.threadEffort }),
        },
      }),
    };
    unwrap(await call.services.projects.update(projectId, patch));
    return textResult("Project settings updated.");
  },
});
