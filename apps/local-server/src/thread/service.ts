import type {
  BlockedQuestion,
  MessagePage,
  Project,
  Thread,
  ThreadActivity,
  ThreadStatus,
  ThreadStep,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import { discardStagedImages } from "../attachment/service.ts";
import type { MessageOrigin } from "../chat-session/message-origin.ts";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import type { ChatEngine } from "../project/engine.ts";
import { recordThreadRemoved, recordThreadUpserted } from "../project/events.ts";
import { resolveSessionRuntime } from "../project/runtime.ts";
import { stopProjectSession } from "../project/session-control.ts";
import {
  listWireMessages,
  type MessagePageRequest,
  UNKNOWN_PAGE_ANCHOR,
} from "../project/wire-messages.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { recordSuggestionsChanged } from "../suggestion/events.ts";
import { createSuggestionRepository } from "../suggestion/repository.ts";
import { readThreadActivity } from "./activity.ts";
import { changeThread as applyPatch } from "./change.ts";
import type { ThreadGit } from "./git.ts";
import { createThreadRepository, type ThreadPatch } from "./repository.ts";
import { invalidMessage, planTarget, readMessageInput, threadTitle } from "./spawn-target.ts";
import { insertThreadSession } from "./thread-session.ts";
import type { ThreadError, ThreadResult } from "./types.ts";

/** What a thread is known by before it has been read back from the database. */
type SpawnedThread = Pick<Thread, "id" | "projectId" | "title" | "repoId" | "branch">;

/** `images` are the ids of images uploaded to the thread's project for this message, in order. */
interface SendOptions {
  onlyIn?: readonly ThreadStatus[];
  images?: readonly string[];
}

export interface SpawnThreadInput {
  /** Defaults to the first line of the prompt. */
  title?: string;
  /** The thread's first message: the brief it works from. */
  prompt: string;
  /** Required when the project has several repos; defaults to the only one. */
  repoId?: string | null;
  /** The person's own words, shown as a forwarded quote above the brief. */
  quote?: string | null;
  /**
   * Runs the thread read-only whatever access the project gives its threads: file edits and
   * commands that change things are denied, for good (a new project's survey).
   */
  readOnly?: boolean;
  /**
   * Runs in the transaction that stores the thread, once its session exists. What it writes
   * commits with the thread or not at all, and a throw keeps the thread from being made.
   */
  inTransaction?: (tx: PublisherTransaction, threadId: string) => Promise<void>;
}

export interface ThreadService {
  spawn: (projectId: string, input: SpawnThreadInput) => Promise<ThreadResult<{ thread: Thread }>>;
  list: (projectId: string) => Promise<ThreadResult<{ threads: Thread[] }>>;
  get: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
  /** The latest page of a thread's transcript, or the one before message `page.before`. */
  listMessages: (threadId: string, page?: MessagePageRequest) => Promise<ThreadResult<MessagePage>>;
  /**
   * Steers a thread: queued while it works, a new turn while it is idle, a reopen once resolved.
   * With `onlyIn`, the message is sent only if the thread is in one of those statuses when it is
   * stored, which nothing that releases its worktree can change meanwhile; otherwise it is
   * refused as busy and nothing is stored or made.
   */
  send: (
    threadId: string,
    text: string,
    origin?: MessageOrigin,
    options?: SendOptions,
  ) => Promise<ThreadResult<{ thread: Thread }>>;
  /** Answers the question a thread is waiting on; the answer resumes its runtime session. */
  reply: (threadId: string, text: string) => Promise<ThreadResult<{ thread: Thread }>>;
  /** Ends a rate-limited thread's wait now instead of at its reset; the thread takes up its work again. */
  resume: (threadId: string) => Promise<ThreadResult<{ thread: Thread }>>;
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
  /** The tool calls and status paragraphs of the thread's latest turns, which its messages do not carry. */
  activity: (threadId: string) => Promise<ThreadResult<{ activity: ThreadActivity }>>;
  /** What the thread changed in its worktree: the files, and one file's hunks. */
  changes: ThreadGit["changes"];
  changedFile: ThreadGit["changedFile"];
  /** The thread's pull request: opened at most once, merged, and kept in step with GitHub. */
  openPullRequest: ThreadGit["openPullRequest"];
  mergePullRequest: ThreadGit["mergePullRequest"];
  syncPullRequest: ThreadGit["syncPullRequest"];
  /** Closes the thread out: its worktree goes, its branch stays, and a message can reopen it. */
  resolve: ThreadGit["resolve"];
  /** Deletes the thread with its worktree and branch. */
  remove: (threadId: string) => Promise<ThreadResult<Record<never, never>>>;
}

export const createThreadService = (
  ctx: LocalServerContext,
  chat: ChatEngine,
  git: ThreadGit,
): ThreadService => {
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

  // Asked as a message is stored, inside the thread's turn in the checkout's queue.
  const allowedIn = (threadId: string, statuses?: readonly ThreadStatus[]) =>
    statuses
      ? async () => inStatus(await ctx.threadRepository.getById(threadId), statuses)
      : undefined;

  const sendToThread = async (
    thread: Thread,
    text: string,
    origin: MessageOrigin | null,
    { onlyIn, images = [] }: SendOptions = {},
  ): Promise<ThreadResult<{ thread: Thread }>> => {
    const active = await activeProject(thread.projectId);
    if ("error" in active) return { success: false, error: active.error };
    const input = await readMessageInput(thread.projectId, text, images);
    if ("error" in input) return { success: false, error: input.error };
    // A merge that finishes would take the worktree from under the turn this message starts.
    if (thread.status === "landing") return { success: false, error: { code: "THREAD_BUSY" } };
    // A resolved thread's worktree is gone; a turn needs it back, and nothing may take it away
    // again between the two, so the message is stored (and the turn started) while it is held.
    const started = await git.holding(
      thread,
      () => chat.sendMessage(thread.id, { content: text, origin, imageAttachments: input.images }),
      allowedIn(thread.id, onlyIn),
    );
    if (!started.success) return started;
    if (!started.value.success) {
      return { success: false, error: { code: "SEND_FAILED", reason: started.value.error.code } };
    }
    await discardStagedImages(thread.projectId, images);
    return reload(thread.id);
  };

  const deleteSession = async (
    thread: Pick<Thread, "id" | "projectId">,
  ): Promise<ThreadResult<Record<never, never>>> => {
    // A proposal this thread was started from is open again once the thread is gone.
    const reopened = await createSuggestionRepository(ctx.db).messagesStartedAs(thread.id);
    const deleted = await chat.delete(thread.id);
    if (!deleted.success && deleted.error.code === "RUN_IN_PROGRESS") {
      return { success: false, error: { code: "SESSION_BUSY", sessionId: thread.id } };
    }
    await ctx.eventPublisher.transaction(async (tx) => {
      await recordThreadRemoved(tx, thread.projectId, thread.id);
      await recordSuggestionsChanged(tx, thread.projectId, reopened);
    });
    return { success: true };
  };

  // The worktree and branch go before the session: a delete that stops halfway leaves a thread
  // that can be deleted again, not a directory that nothing owns.
  const removeThread = async (
    thread: SpawnedThread,
  ): Promise<ThreadResult<Record<never, never>>> => {
    const released = await git.discard(thread);
    return released.success ? deleteSession(thread) : released;
  };

  // Stop has waited for the session to go idle, so a thread still `working`, `queued`,
  // `rate-limited` or `waiting-on-you` has no turn behind it: a wait Stop ends (for the person, a
  // free run slot or a rate limit's reset), or a status left stale by a failure that kept its run
  // from settling the thread.
  const endStoppedThread = async (threadId: string): Promise<void> => {
    const thread = await ctx.threadRepository.getById(threadId);
    if (!thread || !STOP_ENDS.has(thread.status)) return;
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
    await applyPatch(ctx, threadId, patch);
    return reload(threadId);
  };

  // Everything a new thread needs that can be refused, decided before anything is written.
  const planSpawn = async (
    projectId: string,
    input: SpawnThreadInput,
  ): Promise<
    | { project: Project; thread: SpawnedThread; repo: Repo | null; workspace: string }
    | { error: ThreadError }
  > => {
    const active = await activeProject(projectId);
    if ("error" in active) return active;
    const invalid = invalidMessage(input.prompt);
    if (invalid) return { error: invalid };
    const threadId = generateTypeId("isess");
    const title = threadTitle(input.title, input.prompt);
    const target = await planTarget(
      ctx,
      git.chooseBranch,
      active.project,
      { threadId, title },
      input.repoId ?? null,
    );
    if ("error" in target) return target;
    const thread = {
      id: threadId,
      projectId,
      title,
      repoId: target.repo?.id ?? null,
      branch: target.branch,
    };
    return { project: active.project, thread, repo: target.repo, workspace: target.workspace };
  };

  const spawn: ThreadService["spawn"] = async (projectId, input) => {
    const plan = await planSpawn(projectId, input);
    if ("error" in plan) return { success: false, error: plan.error };
    const { project, thread } = plan;
    const runtime = await resolveSessionRuntime(runtimeConfigurations, project.thread);
    // The session is stored before its worktree exists, so everything on disk has an owner in
    // the database; a spawn that stops halfway leaves a thread whose next turn makes the worktree.
    await ctx.eventPublisher.transaction(async (tx) => {
      await insertThreadSession(tx.db, {
        id: thread.id,
        project,
        title: thread.title,
        repo: plan.repo,
        workspace: plan.workspace,
        branch: thread.branch,
        runtime,
        readOnly: input.readOnly ?? false,
      });
      await recordThreadUpserted(tx, thread.id);
      await input.inTransaction?.(tx, thread.id);
    });

    const ready = await git.provision(thread);
    if (!ready.success) {
      await removeThread(thread);
      return ready;
    }
    const sent = await chat.sendMessage(thread.id, {
      content: input.prompt,
      origin: { type: "coordinator-relay", quote: input.quote?.trim() || null },
    });
    if (sent.success) return reload(thread.id);
    await removeThread(thread);
    return { success: false, error: { code: "SEND_FAILED", reason: sent.error.code } };
  };

  return {
    spawn,

    list: async (projectId) =>
      (await ctx.projectRepository.getById(projectId))
        ? { success: true, threads: await ctx.threadRepository.listByProject(projectId) }
        : { success: false, error: { code: "PROJECT_NOT_FOUND" } },

    get: reload,

    listMessages: async (threadId, page) => {
      const session = await threadSession(ctx, threadId);
      if (!session) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      const listed = await listWireMessages(ctx.db, session, page);
      return listed
        ? { success: true, ...listed }
        : { success: false, error: { code: "INVALID_MESSAGE", message: UNKNOWN_PAGE_ANCHOR } };
    },

    send: async (threadId, text, origin, options) => {
      const thread = await ctx.threadRepository.getById(threadId);
      return thread
        ? sendToThread(thread, text, origin ?? null, options)
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

    resume: async (threadId) => {
      const thread = await ctx.threadRepository.getById(threadId);
      if (!thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      if (thread.status !== "rate-limited") {
        return { success: false, error: { code: "NOT_RATE_LIMITED" } };
      }
      await chat.resumeRateLimited(threadId);
      return reload(threadId);
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

    activity: (threadId) => readThreadActivity(ctx, threadId),
    changes: git.changes,
    changedFile: git.changedFile,
    openPullRequest: git.openPullRequest,
    mergePullRequest: git.mergePullRequest,
    syncPullRequest: git.syncPullRequest,
    resolve: git.resolve,

    remove: async (threadId) => {
      const session = await threadSession(ctx, threadId);
      const thread = session ? await ctx.threadRepository.getById(threadId) : null;
      if (!session || !thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
      // A worktree is not taken from under a turn that would not stop.
      if (!(await stopProjectSession(ctx, chat, session))) {
        return { success: false, error: { code: "SESSION_BUSY", sessionId: threadId } };
      }
      return removeThread(thread);
    },
  };
};

const inStatus = (thread: Thread | null, statuses: readonly ThreadStatus[]): boolean =>
  thread !== null && statuses.includes(thread.status);

const STOP_ENDS: ReadonlySet<ThreadStatus> = new Set([
  "waiting-on-you",
  "working",
  "queued",
  "rate-limited",
]);

/** The chat session behind a thread; a coordinator or a plain session is not a thread. */
const threadSession = async (ctx: LocalServerContext, threadId: string) => {
  const session = await ctx.chatSessionRepository.getById(threadId);
  return session?.kind === "thread" ? session : null;
};
