import { type CliProvider, CliProviderSchema } from "@aop/common";
import type { Kysely } from "kysely";
import type { ChatSessionKind, Database } from "../db/schema.ts";
import type { RunUsageEntry } from "./types.ts";

/** One run's usage of one model, with the session that owns the run. */
export interface UsageRecord extends RunUsageEntry {
  runId: string;
  provider: CliProvider;
  sessionId: string;
  sessionTitle: string;
  /** Null for a session outside any project. */
  sessionKind: ChatSessionKind | null;
}

/** What to sum: one run, every run of a session (a thread or a coordinator), or of a project. */
export type UsageScope =
  | { kind: "run"; id: string }
  | { kind: "session"; id: string }
  | { kind: "project"; id: string };

/** Bounds on when a run finished, as `Date.toISOString()` strings: `since` inclusive, `until` exclusive. */
export interface UsageBounds {
  since: string | null;
  until: string | null;
}

export interface UsageRepository {
  /**
   * Stores what the run consumed, replacing anything recorded for it before, so recording
   * the same run twice leaves the same rows.
   */
  record: (
    runId: string,
    provider: CliProvider,
    entries: RunUsageEntry[],
    recordedAt: string,
  ) => Promise<void>;
  /** Oldest first. */
  list: (scope: UsageScope, bounds: UsageBounds) => Promise<UsageRecord[]>;
  /** Whether the session or project exists, so an empty list can mean "no usage yet". */
  exists: (scope: { kind: "session" | "project"; id: string }) => Promise<boolean>;
  /** The session a run belongs to, or null when there is no such run. */
  getRunSessionId: (runId: string) => Promise<string | null>;
}

const SCOPE_COLUMN = {
  run: "run_usage.run_id",
  session: "chat_sessions.id",
  project: "chat_sessions.project_id",
} as const;

export const createUsageRepository = (db: Kysely<Database>): UsageRepository => ({
  record: (runId, provider, entries, recordedAt) =>
    db.transaction().execute(async (trx) => {
      await trx.deleteFrom("run_usage").where("run_id", "=", runId).execute();
      if (entries.length === 0) return;
      await trx
        .insertInto("run_usage")
        .values(
          entries.map((entry) => ({
            run_id: runId,
            model: entry.model,
            provider,
            input_tokens: entry.inputTokens,
            output_tokens: entry.outputTokens,
            cache_write_tokens: entry.cacheWriteTokens,
            cache_read_tokens: entry.cacheReadTokens,
            cost_usd: entry.costUsd,
            recorded_at: recordedAt,
          })),
        )
        .execute();
    }),

  list: async (scope, bounds) => {
    let query = db
      .selectFrom("run_usage")
      .innerJoin("chat_runs", "chat_runs.id", "run_usage.run_id")
      .innerJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
      .select([
        "run_usage.run_id",
        "run_usage.provider",
        "run_usage.model",
        "run_usage.input_tokens",
        "run_usage.output_tokens",
        "run_usage.cache_write_tokens",
        "run_usage.cache_read_tokens",
        "run_usage.cost_usd",
        "chat_sessions.id as session_id",
        "chat_sessions.title as session_title",
        "chat_sessions.kind as session_kind",
      ])
      .where(SCOPE_COLUMN[scope.kind], "=", scope.id);
    if (bounds.since !== null) query = query.where("run_usage.recorded_at", ">=", bounds.since);
    if (bounds.until !== null) query = query.where("run_usage.recorded_at", "<", bounds.until);
    const rows = await query
      .orderBy("run_usage.recorded_at")
      .orderBy("run_usage.run_id")
      .orderBy("run_usage.model")
      .execute();
    return rows.map((row) => ({
      runId: row.run_id,
      provider: CliProviderSchema.parse(row.provider),
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      cacheReadTokens: row.cache_read_tokens,
      costUsd: row.cost_usd,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      sessionKind: row.session_kind,
    }));
  },

  exists: async (scope) => {
    const row = await db
      .selectFrom(scope.kind === "session" ? "chat_sessions" : "projects")
      .select("id")
      .where("id", "=", scope.id)
      .executeTakeFirst();
    return row !== undefined;
  },

  getRunSessionId: async (runId) => {
    const row = await db
      .selectFrom("chat_runs")
      .select("session_id")
      .where("id", "=", runId)
      .executeTakeFirst();
    return row?.session_id ?? null;
  },
});
