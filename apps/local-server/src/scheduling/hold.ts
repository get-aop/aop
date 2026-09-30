import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/*
 * A coordinator waiting out a rate limit. A thread's wait is its `rate-limited` status, which
 * carries the time it resumes; a coordinator has no status, so its wait is only the
 * `resumes_at` column, which the resume timer is re-armed from after a restart. While it is set
 * the coordinator's inbox is held: thread reports that arrive wait instead of starting runs the
 * limit would refuse.
 */

export const holdCoordinator = async (
  db: Kysely<Database>,
  sessionId: string,
  resumesAt: string,
): Promise<void> => {
  await db
    .updateTable("chat_sessions")
    .set({ resumes_at: resumesAt })
    .where("id", "=", sessionId)
    .where("kind", "=", "coordinator")
    .execute();
};

export const releaseCoordinator = async (
  db: Kysely<Database>,
  sessionId: string,
): Promise<void> => {
  await db
    .updateTable("chat_sessions")
    .set({ resumes_at: null })
    .where("id", "=", sessionId)
    .where("kind", "=", "coordinator")
    .where("resumes_at", "is not", null)
    .execute();
};
