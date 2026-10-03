import { DEFAULT_MAX_CONCURRENT_RUNS, parseMaxConcurrentRuns } from "@aop/common";
import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";

/*
 * The host runs at most `max_concurrent_runs` thread turns at once. Only thread turns count and
 * only they wait: a coordinator turn or a plain chat is something a person is waiting on, is
 * bounded by one per session, and must never sit behind a queue of background work.
 */

/** The cap; a stored value that is not a valid cap (the row was edited by hand) is the default. */
export const readRunCap = async (settings: SettingsRepository): Promise<number> =>
  parseMaxConcurrentRuns(await settings.get(SettingKey.MAX_CONCURRENT_RUNS)) ??
  DEFAULT_MAX_CONCURRENT_RUNS;

/** A turn running now, named for the person: a thread's title, a coordinator's project. */
export interface RunningTurnRow {
  runId: string;
  title: string;
  kind: "thread" | "coordinator" | "chat";
}

/** Turns of any kind running now, oldest first: what a host update would restart under. */
export const listRunningTurns = async (db: Kysely<Database>): Promise<RunningTurnRow[]> => {
  const rows = await db
    .selectFrom("chat_runs")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
    .leftJoin("projects", "projects.id", "chat_sessions.project_id")
    .select([
      "chat_runs.id as runId",
      "chat_sessions.title as title",
      "chat_sessions.kind as kind",
      "projects.name as projectName",
    ])
    .where("chat_runs.status", "=", "running")
    .orderBy("chat_runs.created_at")
    .execute();
  return rows.map((row) => ({
    runId: row.runId,
    title: row.kind === "coordinator" ? `${row.projectName ?? "Project"} coordinator` : row.title,
    kind: row.kind ?? "chat",
  }));
};

/**
 * Thread turns running now. It counts `chat_runs` rows, not in-memory registrations, so a run a
 * restarted server is still recovering holds its slot until it ends.
 */
export const countRunningThreadRuns = async (db: Kysely<Database>): Promise<number> => {
  const row = await db
    .selectFrom("chat_runs")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
    .select(sql<number>`COUNT(*)`.as("running"))
    .where("chat_runs.status", "=", "running")
    .where("chat_sessions.kind", "=", "thread")
    .executeTakeFirstOrThrow();
  return Number(row.running);
};
