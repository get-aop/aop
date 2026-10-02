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

/**
 * Turns of any kind running now (threads, coordinators, chats): what AOP Nightly waits on before
 * it restarts itself onto a new build.
 */
export const countRunningRuns = async (db: Kysely<Database>): Promise<number> => {
  const row = await db
    .selectFrom("chat_runs")
    .select(sql<number>`COUNT(*)`.as("running"))
    .where("status", "=", "running")
    .executeTakeFirstOrThrow();
  return Number(row.running);
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
