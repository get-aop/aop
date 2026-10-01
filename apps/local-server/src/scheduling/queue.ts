import type { ThreadStatus } from "@aop/common";
import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";

/*
 * The run queue is not a table. A queued turn is a user message that has no run yet, which is
 * already durable and already how a steer waits for its session, so nothing about the queue
 * needs recovering after a restart beyond looking again.
 */

/** Whether the session has a user message waiting for its run: a steer, a queued turn, a report. */
export const hasQueuedMessage = async (
  db: Kysely<Database>,
  sessionId: string,
): Promise<boolean> => {
  const row = await db
    .selectFrom("chat_messages")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .where("steered_run_id", "is", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
};

export interface QueuedThreadTurn {
  sessionId: string;
  runtime: string;
  /** The thread's status now, so a caller can tell who is not yet shown as queued. */
  state: ThreadStatus | null;
}

/**
 * The thread sessions with a turn ready to start, first come first served: ordered by when their
 * oldest waiting message was stored. A session is ready when it has no run going (a steer waits
 * for its own session first), is not waiting out a rate limit, and its project is active.
 */
export const listQueuedThreadTurns = async (db: Kysely<Database>): Promise<QueuedThreadTurn[]> =>
  db
    .selectFrom("chat_messages")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_messages.session_id")
    .innerJoin("projects", "projects.id", "chat_sessions.project_id")
    .select([
      "chat_sessions.id as sessionId",
      "chat_sessions.runtime as runtime",
      "chat_sessions.state as state",
    ])
    .select(sql<string>`MIN(chat_messages.created_at)`.as("queuedAt"))
    .where("chat_sessions.kind", "=", "thread")
    .where("chat_sessions.resumes_at", "is", null)
    .where("projects.status", "=", "active")
    .where("chat_messages.role", "=", "user")
    .where("chat_messages.steered_run_id", "is", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("chat_runs.id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("chat_runs.id")
            .whereRef("chat_runs.session_id", "=", "chat_sessions.id")
            .where("chat_runs.status", "=", "running"),
        ),
      ),
    )
    .groupBy("chat_sessions.id")
    // Messages stored in the same millisecond keep their insertion order.
    .orderBy("queuedAt")
    .orderBy(sql`MIN(chat_messages.rowid)`)
    .execute();
