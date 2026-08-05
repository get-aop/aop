import type { ChatDelegationRun } from "@aop/common";
import type { Kysely } from "kysely";
import type {
  ChatDelegationRunRecord,
  Database,
  NewChatDelegationRunRecord,
} from "../db/schema.ts";

/**
 * Row-level storage for delegation runs (one row per specialist run, owned by
 * a host chat run). Replaces the legacy JSON blob on chat_runs.delegation_runs
 * so progress writes touch one row instead of rewriting the whole array.
 */
export const listDelegationRuns = async (
  db: Kysely<Database>,
  chatRunId: string,
): Promise<ChatDelegationRun[]> => {
  const rows = await db
    .selectFrom("chat_delegation_runs")
    .selectAll()
    .where("chat_run_id", "=", chatRunId)
    .orderBy("started_at", "asc")
    .execute();
  return rows.map(fromDelegationRunRow);
};

export const listDelegationRunsByChatRunIds = async (
  db: Kysely<Database>,
  chatRunIds: string[],
): Promise<Map<string, ChatDelegationRun[]>> => {
  if (chatRunIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("chat_delegation_runs")
    .selectAll()
    .where("chat_run_id", "in", chatRunIds)
    .orderBy("started_at", "asc")
    .execute();

  const byRun = new Map<string, ChatDelegationRun[]>();
  for (const row of rows) {
    const entries = byRun.get(row.chat_run_id) ?? [];
    entries.push(fromDelegationRunRow(row));
    byRun.set(row.chat_run_id, entries);
  }
  return byRun;
};

/** Replaces every delegation row of a host run (caller holds the host-run lock). */
export const replaceDelegationRuns = async (
  db: Kysely<Database>,
  chatRunId: string,
  entries: ChatDelegationRun[],
): Promise<void> => {
  await db.deleteFrom("chat_delegation_runs").where("chat_run_id", "=", chatRunId).execute();
  if (entries.length === 0) return;
  await db
    .insertInto("chat_delegation_runs")
    .values(entries.map((entry) => toDelegationRunRow(chatRunId, entry)))
    .execute();
};

export const deleteDelegationRunsByChatRunIds = async (
  db: Kysely<Database>,
  chatRunIds: string[],
): Promise<void> => {
  if (chatRunIds.length === 0) return;
  await db.deleteFrom("chat_delegation_runs").where("chat_run_id", "in", chatRunIds).execute();
};

const toDelegationRunRow = (
  chatRunId: string,
  entry: ChatDelegationRun,
): NewChatDelegationRunRecord => ({
  id: entry.id,
  chat_run_id: chatRunId,
  kind: entry.kind,
  label: entry.label,
  runtime: entry.runtime,
  runtime_alias: entry.runtimeAlias,
  runtime_configuration_id: entry.runtimeConfigurationId,
  model: entry.model,
  reasoning: entry.reasoning,
  fast_mode: entry.fastMode ? 1 : 0,
  status: entry.status,
  activity: entry.activity,
  runtime_session_id: entry.runtimeSessionId,
  log_file_path: entry.logFilePath,
  error: entry.error,
  tool_use_id: entry.toolUseId ?? null,
  started_at: entry.startedAt,
  updated_at: entry.updatedAt,
});

const fromDelegationRunRow = (row: ChatDelegationRunRecord): ChatDelegationRun => ({
  id: row.id,
  kind: row.kind as ChatDelegationRun["kind"],
  label: row.label,
  runtime: row.runtime,
  runtimeAlias: row.runtime_alias,
  runtimeConfigurationId: row.runtime_configuration_id,
  model: row.model,
  reasoning: row.reasoning,
  fastMode: row.fast_mode === 1,
  status: row.status as ChatDelegationRun["status"],
  activity: row.activity,
  runtimeSessionId: row.runtime_session_id,
  logFilePath: row.log_file_path,
  error: row.error,
  toolUseId: row.tool_use_id ?? undefined,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
});
