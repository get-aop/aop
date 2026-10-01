import { generateTypeId, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession, Database } from "../db/schema.ts";
import { hasQueuedMessage } from "../scheduling/queue.ts";
import { describeRateLimit, type RateLimitHit } from "../scheduling/rate-limit.ts";
import { serializeMessageOrigin } from "./message-origin.ts";
import { isDbClosedError } from "./reply-state.ts";
import { armResumeTimer, cancelResumeTimer } from "./resume-timers.ts";
import { nextChatTurnIndex } from "./turn-order.ts";

const logger = getLogger("chat-session", "rate-limit-resume");

/** What a session is told when its wait on a rate limit is over. It never shows in a transcript. */
export const RESUME_PROMPT =
  "Your usage limit has reset. Continue with the task where you left off.";

/**
 * The reply and the wait a run that a rate limit refused ends with. A project's session waits
 * out the limit and says so, and whether it resumes by itself; any other chat has nothing to
 * resume it, so its run just fails with what the CLI said.
 */
export const pausedReply = async (
  db: Kysely<Database>,
  session: Pick<ChatSession, "id" | "project_id">,
  text: string,
  hit: RateLimitHit | undefined,
): Promise<{ text: string; rateLimit?: RateLimitHit }> => {
  if (!hit || !session.project_id) return { text };
  const automatic = await continuesByItself(db, session.id);
  return { text: describeRateLimit(hit, new Date(), automatic), rateLimit: hit };
};

/**
 * Whether a session's wait on a limit ends by itself at the reset. A thread follows its project's
 * auto-continue setting; a coordinator always does, since nothing else would release its inbox.
 */
export const continuesByItself = async (
  db: Kysely<Database>,
  sessionId: string,
): Promise<boolean> => {
  const row = await db
    .selectFrom("chat_sessions")
    .leftJoin("projects", "projects.id", "chat_sessions.project_id")
    .select(["chat_sessions.kind", "projects.auto_continue"])
    .where("chat_sessions.id", "=", sessionId)
    .executeTakeFirst();
  return row?.kind !== "thread" || row.auto_continue !== 0;
};

/** Starts a session's next queued turn, the way the engine does after any turn. */
export type DrainSession = (sessionId: string, runtime: string) => Promise<void>;

/**
 * Ends a session's wait on a rate limit and starts its next turn. The wait is the session's
 * `resumes_at`, so this does nothing to a session that is not waiting: a timer that fires twice,
 * a person who resumed by hand a moment earlier, and a restart that re-arms a timer all end the
 * same. Returns whether it resumed the session.
 *
 * The next turn is a message the session already has queued, or else one written here, so the
 * session takes up its work in the runtime session it already has.
 */
export const resumeRateLimited = async (
  ctx: LocalServerContext,
  sessionId: string,
  drain: DrainSession,
): Promise<boolean> => {
  cancelResumeTimer(sessionId);
  const runtime = await ctx.eventPublisher.transaction(async (tx) => {
    const session = await tx.db
      .selectFrom("chat_sessions")
      .select(["runtime", "resumes_at"])
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!session?.resumes_at) return null;
    await ctx.sessionHooks.onTurnScheduled(tx, sessionId, "running");
    if (!(await hasQueuedMessage(tx.db, sessionId))) await queueResumePrompt(tx.db, sessionId);
    return session.runtime;
  });
  if (runtime === null) return false;
  logger.info("Session {sessionId} resumes after a rate limit", { sessionId });
  await drain(sessionId, runtime);
  return true;
};

/**
 * Arms the timer that resumes `sessionId` at `at`, replacing any earlier one. The setting is read
 * when it fires, not now, so turning auto-continue off during the wait keeps the thread waiting;
 * turning it on arms the timers again (`rearmProjectResumes`).
 */
export const armResume = (
  ctx: LocalServerContext,
  sessionId: string,
  at: string,
  drain: DrainSession,
): void => {
  armResumeTimer(sessionId, at, async () => {
    try {
      if (!(await continuesByItself(ctx.db, sessionId))) {
        logger.info("Session {sessionId} waits past its reset: auto-continue is off", {
          sessionId,
        });
        return;
      }
      await resumeRateLimited(ctx, sessionId, drain);
    } catch (error) {
      // A closed database is the server shutting down; the wait is stored and boot re-arms it.
      if (isDbClosedError(error)) return;
      logger.error("Resuming {sessionId} after a rate limit failed: {error}", {
        sessionId,
        error: String(error),
      });
    }
  });
};

/** Boot: a wait that outlived the process is armed again, and one that has come due fires at once. */
export const armStoredResumes = async (
  ctx: LocalServerContext,
  drain: DrainSession,
): Promise<void> => {
  const waiting = await ctx.db
    .selectFrom("chat_sessions")
    .select(["id", "resumes_at"])
    .where("resumes_at", "is not", null)
    .execute()
    .catch(() => []);
  armEach(ctx, waiting, drain);
};

/**
 * Auto-continue turned on: each of the project's waits is armed again, so a thread whose reset
 * passed while it was off resumes at once and the others at their reset.
 */
export const rearmProjectResumes = async (
  ctx: LocalServerContext,
  projectId: string,
  drain: DrainSession,
): Promise<void> => {
  const waiting = await ctx.db
    .selectFrom("chat_sessions")
    .select(["id", "resumes_at"])
    .where("project_id", "=", projectId)
    .where("resumes_at", "is not", null)
    .execute();
  armEach(ctx, waiting, drain);
};

const armEach = (
  ctx: LocalServerContext,
  waiting: { id: string; resumes_at: string | null }[],
  drain: DrainSession,
): void => {
  for (const { id, resumes_at } of waiting) {
    if (resumes_at) armResume(ctx, id, resumes_at, drain);
  }
};

const queueResumePrompt = async (db: Kysely<Database>, sessionId: string): Promise<void> => {
  await db
    .insertInto("chat_messages")
    .values({
      id: generateTypeId("smsg"),
      session_id: sessionId,
      role: "user",
      content: RESUME_PROMPT,
      turn_index: await nextChatTurnIndex(db, sessionId),
      disposition: "queued",
      created_at: new Date().toISOString(),
      origin_json: serializeMessageOrigin({ type: "rate-limit-resume" }),
    })
    .execute();
};
