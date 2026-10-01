import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * A project's first-open kickoff as the host records it (migration v12). Each step is a
 * compare-and-set on the row's state, so a step that two callers race for, or that a restart
 * repeats, happens once.
 */
export interface KickoffRepository {
  /** Records a kickoff whose survey is still to be started. */
  insertPending: (projectId: string) => Promise<void>;
  /** The projects whose survey is still to be started, oldest first. */
  listPending: () => Promise<string[]>;
  /** Names the survey of a pending kickoff; false when the kickoff is not pending (any more). */
  claimSurvey: (projectId: string, surveyThreadId: string) => Promise<boolean>;
  /** Marks the survey's report as sent; false when this thread is no survey waiting to report. */
  markReported: (surveyThreadId: string) => Promise<boolean>;
}

export const createKickoffRepository = (db: Kysely<Database>): KickoffRepository => ({
  insertPending: async (projectId) => {
    await db
      .insertInto("project_kickoffs")
      .values({ project_id: projectId, state: "pending", survey_thread_id: null })
      .execute();
  },

  listPending: async () =>
    (
      await db
        .selectFrom("project_kickoffs")
        .innerJoin("projects", "projects.id", "project_kickoffs.project_id")
        .select("project_kickoffs.project_id")
        .where("project_kickoffs.state", "=", "pending")
        .orderBy("projects.created_at")
        .execute()
    ).map((row) => row.project_id),

  claimSurvey: async (projectId, surveyThreadId) => {
    const claimed = await db
      .updateTable("project_kickoffs")
      .set({ state: "surveying", survey_thread_id: surveyThreadId })
      .where("project_id", "=", projectId)
      .where("state", "=", "pending")
      .executeTakeFirst();
    return claimed.numUpdatedRows > 0n;
  },

  markReported: async (surveyThreadId) => {
    const marked = await db
      .updateTable("project_kickoffs")
      .set({ state: "reported" })
      .where("survey_thread_id", "=", surveyThreadId)
      .where("state", "=", "surveying")
      .executeTakeFirst();
    return marked.numUpdatedRows > 0n;
  },
});
