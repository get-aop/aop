import type { BlockedQuestion, Message, Project, Thread, ThreadStep } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { MessageOrigin } from "../chat-session/message-origin.ts";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import type { ChatEngine } from "../project/engine.ts";
import { recordThreadRemoved, recordThreadUpserted } from "../project/events.ts";
import { resolveSessionRuntime } from "../project/runtime.ts";
import { stopProjectSession } from "../project/session-control.ts";
import { listWireMessages } from "../project/wire-messages.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createThreadRepository, type ThreadPatch } from "./repository.ts";
import { invalidMessage, pickRepo, threadTitle, threadWorkspace } from "./spawn-target.ts";
import { insertThreadSession } from "./thread-session.ts";
import type { ThreadError, ThreadResult } from "./types.ts";

export interface SpawnThreadInput {
  /** Defaults to the first line of the prompt. */
  title?: string;
  /** The thread's first message: the brief it works from. */
  prompt: string;
  /** Required when the project has several repos; defaults to the only one. */
  repoId?: string | null;
  /** The person's own words, shown as a forwarded quote above the brief. */
  quote?: string | null;
}

export interface ThreadService {
  spawn: (projectId: string, input: SpawnThreadInput) => Promise<ThreadResult<{ thread: Thread }>>;
  list: (projectId: string) => Promise<ThreadResult<{ threads: Thread[] }>>;
  get: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
  listMessages: (threadId: string) => Promise<ThreadResult<{ messages: Message[] }>>;
  /** Steers a thread: queued while it works, a new turn while it is idle, a reopen once resolved. */
  send: (
    threadId: string,
    text: string,
    origin?: MessageOrigin,
  ) => Promise<ThreadResult<{ thread: Thread }>>;
  /** Answers the question a thread is waiting on; the answer resumes its runtime session. */
  reply: (threadId: string, text: string) => Promise<ThreadResult<{ thread: Thread }>>;
  stop: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
  /** The thread's own tools: it needs the person's call (waiting on you) or reports progress. */
  askUser: (
    threadId: string,
    question: BlockedQuestion,
  ) => Promise<ThreadResult<{ thread: Thread }>>;
  reportStatus: (
    threadId: string,
    report: { line?: string | null; steps?: ThreadStep[] },
  ) => Promise<ThreadResult<{ thread: Thread }>>;
  markRead: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
  remove: (threadId: string) => Promise<ThreadResult<Record<never, never>>>;
}

export const createThreadService = (ctx: LocalServerContext, chat: ChatEngine): ThreadService => {
  const runtimeConfigurations = createRuntimeConfigurationRepository(ctx.db);

  const reload = async (threadId: string): Promise<ThreadResult<{ thread: Thread }>> => {
    const thread = await ctx.threadRepository.getById(threadId);
    return thread
      ? { success: true, thread }
      : { success: false, error: { code: "THREAD_NOT_FOUND" } };
  };

  const activeProject = async (
    projectId: string,
  ): Promise<{ project: Project } | { error: ThreadError }> => {
    const project = await ctx.projectRepository.getById(projectId);
    if (!project) return { error: { code: "PROJECT_NOT_FOUND" } };
    if (project.status !== "active") {
      return { error: { code: "PROJECT_NOT_ACTIVE", status: project.status } };
    }
    return { project };
  };

  const sendToThread = async (
    thread: Thread,
    text: string,
    origin: MessageOrigin | null,
  ): Promise<ThreadResult<{ thread: Thread }>> => {
    const active = await activeProject(thread.projectId);
    if ("error" in active) return { success: false, error: active.error };
    const invalid = invalidMessage(text);
    if (invalid) return { success: false, error: invalid };
    const sent = await chat.sendMessage(thread.id, { content: text, origin });
    return sent.success
      ? reload(thread.id)
      : { success: false, error: { code: "SEND_FAILED", reason: sent.error.code } };
  };

  const removeThread = async (threadId: string, projectId: string): Promise<void> => {
    await chat.delete(threadId);
    await ctx.eventPublisher.transaction((tx) => recordThreadRemoved(tx, projectId, threadId));
  };

  // Stop has waited for the session to go idle, so a thread still `working` or `waiting-on-you`
  // has no turn behind it: a wait for the person that Stop ends, or a status left stale by a
  // failure that kept its run from settling the thread.
  const endStoppedThread = async (threadId: string): Promise<void> => {
    const thread = await ctx.threadRepository.getById(threadId);
    if (thread?.status !== "waiting-on-you" && thread?.status !== "working") return;
    await ctx.eventPublisher.transaction(async (tx) => {
      await createThreadRepository(tx.db).update(threadId, {
        status: { status: "idle" },
        liveStatusLine: "Stopped",
      });
      await recordThreadUpserted(tx, threadId);
    });
  };

  const changeThread = async (
    threadId: string,
    patch: ThreadPatch,
  ): Promise<ThreadResult<{ thread: Thread }>> => {
    if (!(await ctx.threadRepository.getById(threadId))) {
      return { success: false, error: { code: "THREAD_NOT_FOUND" } };
    }
    await ctx.eventPublisher.transaction(async (tx) => {
      await createThreadRepository(tx.db).update(threadId, patch);
      await recordThreadUpserted(tx, threadId);
    });
    return reload(threadId);
  };

  // Everything a new thread needs that can be refused, decided before anything is written.
  const planSpawn = async (
    projectId: string,
    input: SpawnThreadInput,
  ): Promise<
    | { project: Project; threadId: string; repo: Repo | null; workspace: string }
    | { error: ThreadError }
  > => {
    const active = await activeProject(projectId);
    if ("error" in active) return active;
    const invalid = invalidMessage(input.prompt);
    if (invalid) return { error: invalid };
    const target = await pickRepo(ctx, active.project, input.repoId ?? null);
    if ("error" in target) return target;
    const threadId = generateTypeId("isess");
    const workspace = await threadWorkspace(projectId, threadId, target.repo);
    if (typeof workspace !== "string") return workspace;
    return { project: active.project, threadId, repo: target.repo, workspace };
  };

  const spawn: ThreadService["spawn"] = async (projectId, input) => {
    const plan = await planSpawn(projectId, input);
    if ("error" in plan) return { success: false, error: plan.error };
    const { project, threadId } = plan;
    const runtime = await resolveSessionRuntime(runtimeConfigurations, project.thread);
    await ctx.eventPublisher.transaction(async (tx) => {
      await insertThreadSession(tx.db, {
        id: threadId,
        project,
        title: threadTitle(input.title, input.prompt),
        repo: plan.repo,
        workspace: plan.workspace,
        runtime,
      });
      await recordThreadUpserted(tx, threadId);
    });

    const sent = await chat.sendMessage(threadId, {
      content: input.prompt,
      origin: { type: "coordinator-relay", quote: input.quote?.trim() || null },
    });
    if (sent.success) return reload(threadId);
    await removeThread(threadId, project.id);
    return { success: false, error: { code: "SEND_FAILED", reason: sent.error.code } };
  };

  return {
    spawn,

    list: async (projectId) =>
      (await ctx.projectRepository.getById(projectId))
        ? { success: true, threads: await ctx.threadRepository.listByProject(projectId) }
        : { success: false, error: { code: "PROJECT_NOT_FOUND" } },

    get: reload,

    listMessages: async (threadId) => {
      const session = await threadSession(ctx, threadId);
      return session
        ? { success: true, messages: await listWireMessages(ctx.db, session) }
        : { success: false, error: { code: "THREAD_NOT_FOUND" } };
    },

    send: async (threadId, text, origin) => {
      const thread = await ctx.threadRepository.getById(threadId);
      return thread
        ? sendToThread(thread, text, origin ?? null)
        : { success: false, error: { code: "THREAD_NOT_FOUND" } };
    },

    reply: async (threadId, text) => {
      const thread = await ctx.threadRepository.getById(threadId);
      if (!thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      if (thread.status !== "waiting-on-you") {
        return { success: false, error: { code: "NOT_WAITING" } };
      }
      return sendToThread(thread, text, null);
    },

    stop: async (threadId) => {
      const session = await threadSession(ctx, threadId);
      if (!session) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      await stopProjectSession(ctx, chat, session);
      await endStoppedThread(threadId);
      return reload(threadId);
    },

    askUser: async (threadId, question) =>
      changeThread(threadId, {
        status: { status: "waiting-on-you", blockedQuestion: question },
        lastActivityAt: new Date().toISOString(),
      }),

    reportStatus: async (threadId, report) =>
      changeThread(threadId, {
        ...(report.steps && { steps: report.steps }),
        ...(report.line !== undefined && { liveStatusLine: report.line }),
        lastActivityAt: new Date().toISOString(),
      }),

    markRead: async (threadId) => {
      const thread = await ctx.threadRepository.getById(threadId);
      if (!thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      if (thread.unread) {
        await ctx.eventPublisher.transaction(async (tx) => {
          await createThreadRepository(tx.db).update(threadId, { unread: false });
          await recordThreadUpserted(tx, threadId);
        });
      }
      return reload(threadId);
    },

    remove: async (threadId) => {
      const session = await threadSession(ctx, threadId);
      if (!session?.project_id) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      await stopProjectSession(ctx, chat, session);
      await removeThread(threadId, session.project_id);
      return { success: true };
    },
  };
};

/** The chat session behind a thread; a coordinator or a plain session is not a thread. */
const threadSession = async (ctx: LocalServerContext, threadId: string) => {
  const session = await ctx.chatSessionRepository.getById(threadId);
  return session?.kind === "thread" ? session : null;
};
