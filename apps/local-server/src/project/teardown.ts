import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { ThreadGit } from "../thread/git.ts";
import type { ChatEngine } from "./engine.ts";
import { stopProjectSession } from "./session-control.ts";

const logger = getLogger("project", "teardown");

export type TeardownResult =
  | { success: true }
  | {
      success: false;
      error:
        | { code: "SESSION_BUSY"; sessionId: string }
        | { code: "WORKTREE_FAILED"; message: string };
    };

/**
 * What a project does with its running work when it leaves the active state or is deleted:
 * sessions are stopped, a thread's worktree goes before its session (so a step that fails can
 * be run again), and a thread that would not stop keeps its worktree, since it works in it.
 */
export interface ProjectTeardown {
  /** Stops every session; resolves to the ones that would not go idle. */
  stopSessions: (sessions: ChatSession[]) => Promise<ChatSession[]>;
  /** Removes the worktrees of a project's threads and keeps their branches. */
  parkThreads: (projectId: string) => Promise<void>;
  /** Stops and deletes a project's sessions, threads with their worktrees and branches first. */
  deleteSessions: (sessions: ChatSession[]) => Promise<TeardownResult>;
}

interface Env {
  ctx: LocalServerContext;
  chat: ChatEngine;
  git: ThreadGit;
}

export const createProjectTeardown = (
  ctx: LocalServerContext,
  chat: ChatEngine,
  git: ThreadGit,
): ProjectTeardown => {
  const env = { ctx, chat, git };
  return {
    stopSessions: (sessions) => stopSessions(env, sessions),
    parkThreads: (projectId) => parkThreads(env, projectId),
    deleteSessions: (sessions) => deleteSessions(env, sessions),
  };
};

const stopSessions = async ({ ctx, chat }: Env, sessions: ChatSession[]) => {
  const busy: ChatSession[] = [];
  for (const session of sessions) {
    if (!(await stopProjectSession(ctx, chat, session))) busy.push(session);
  }
  return busy;
};

const parkThreads = async ({ ctx, git }: Env, projectId: string): Promise<void> => {
  for (const thread of await ctx.threadRepository.listByProject(projectId)) {
    if (thread.status === "working") continue;
    const parked = await git.park(thread);
    if (parked.success) continue;
    logger.warn("Thread {threadId} kept its worktree when its project was archived: {error}", {
      threadId: thread.id,
      error: parked.error.code === "WORKTREE_FAILED" ? parked.error.message : parked.error.code,
    });
  }
};

const deleteSessions = async (env: Env, sessions: ChatSession[]): Promise<TeardownResult> => {
  const [busy] = await stopSessions(env, sessions);
  if (busy) return { success: false, error: { code: "SESSION_BUSY", sessionId: busy.id } };
  for (const session of sessions) {
    const deleted = await deleteSession(env, session);
    if (!deleted.success) return deleted;
  }
  return { success: true };
};

// The worktree and branch go first, so a delete that stops halfway can simply be run again.
const deleteSession = async ({ ctx, chat, git }: Env, session: ChatSession) => {
  const thread = session.kind === "thread" ? await ctx.threadRepository.getById(session.id) : null;
  const released = thread ? await git.discard(thread) : { success: true as const };
  if (!released.success) {
    return released.error.code === "THREAD_BUSY"
      ? { success: false as const, error: { code: "SESSION_BUSY" as const, sessionId: session.id } }
      : { success: false as const, error: released.error };
  }
  const deleted = await chat.delete(session.id);
  return !deleted.success && deleted.error.code === "RUN_IN_PROGRESS"
    ? { success: false as const, error: { code: "SESSION_BUSY" as const, sessionId: session.id } }
    : { success: true as const };
};
