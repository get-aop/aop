import { rm } from "node:fs/promises";
import {
  BACKGROUND_TASK_LIMIT,
  type ChatDelegationRun,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";

export const BACKGROUND_TASK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface BackgroundTaskRef {
  entry: ChatDelegationRun;
  entryIndex: number;
  hostRunId: string;
  runCreatedAt: string;
  sessionId: string;
}

/** Keep only the most recent background tasks for each chat session. */
export const pruneOldBackgroundTasks = async (
  ctx: LocalServerContext,
  sessionId?: string,
): Promise<number> => {
  const rows = await queryDelegationRows(ctx, sessionId);
  const tasksBySession = groupBackgroundTasks(rows);
  let removed = 0;

  for (const tasks of tasksBySession.values()) {
    const stale = [...tasks].sort(compareNewestFirst).slice(BACKGROUND_TASK_LIMIT);
    if (stale.length === 0) continue;
    removed += await removeBackgroundTasks(ctx, stale);
  }

  return removed;
};

const queryDelegationRows = async (ctx: LocalServerContext, sessionId?: string) => {
  let query = ctx.db
    .selectFrom("chat_runs")
    .select([
      "id as hostRunId",
      "session_id as sessionId",
      "delegation_runs as delegationRuns",
      "created_at as runCreatedAt",
    ])
    .where("delegation_runs", "is not", null);
  if (sessionId) query = query.where("session_id", "=", sessionId);
  return query.execute();
};

const groupBackgroundTasks = (
  rows: Awaited<ReturnType<typeof queryDelegationRows>>,
): Map<string, BackgroundTaskRef[]> => {
  const grouped = new Map<string, BackgroundTaskRef[]>();
  for (const row of rows) {
    const tasks = parseChatDelegationRuns(row.delegationRuns)
      .map((entry, entryIndex) => ({
        entry,
        entryIndex,
        hostRunId: row.hostRunId,
        runCreatedAt: row.runCreatedAt,
        sessionId: row.sessionId,
      }))
      .filter((item) => item.entry.kind === "background-task");
    if (tasks.length === 0) continue;
    const existing = grouped.get(row.sessionId) ?? [];
    existing.push(...tasks);
    grouped.set(row.sessionId, existing);
  }
  return grouped;
};

const compareNewestFirst = (left: BackgroundTaskRef, right: BackgroundTaskRef): number =>
  right.entry.startedAt.localeCompare(left.entry.startedAt) ||
  right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
  right.runCreatedAt.localeCompare(left.runCreatedAt) ||
  right.entryIndex - left.entryIndex;

const removeBackgroundTasks = async (
  ctx: LocalServerContext,
  stale: BackgroundTaskRef[],
): Promise<number> => {
  const staleIdsByRun = new Map<string, Set<string>>();
  for (const task of stale) {
    const ids = staleIdsByRun.get(task.hostRunId) ?? new Set<string>();
    ids.add(task.entry.id);
    staleIdsByRun.set(task.hostRunId, ids);
  }

  let removed = 0;
  for (const [hostRunId, staleIds] of staleIdsByRun) {
    const deleted = await removeFromHostRun(ctx, hostRunId, staleIds);
    removed += deleted.entries.length;
    await Promise.all(
      deleted.entries.map((entry) => rm(entry.logFilePath, { force: true }).catch(() => {})),
    );
  }
  return removed;
};

const removeFromHostRun = async (
  ctx: LocalServerContext,
  hostRunId: string,
  staleIds: Set<string>,
): Promise<{ entries: ChatDelegationRun[] }> =>
  ctx.db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("chat_runs")
      .select("delegation_runs")
      .where("id", "=", hostRunId)
      .executeTakeFirst();
    if (!row) return { entries: [] };

    const entries = parseChatDelegationRuns(row.delegation_runs);
    const deleted = entries.filter((entry) => staleIds.has(entry.id));
    if (deleted.length === 0) return { entries: [] };

    await trx
      .updateTable("chat_runs")
      .set({
        delegation_runs: serializeChatDelegationRuns(
          entries.filter((entry) => !staleIds.has(entry.id)),
        ),
      })
      .where("id", "=", hostRunId)
      .execute();
    return { entries: deleted };
  });
